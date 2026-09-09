use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use tiny_http::{Header, Method, Response, Server};

#[derive(Serialize)]
struct Session {
    id: String,
    app: String,
    title: String,
    start_utc: i64,
    end_utc: i64,
    source: String,
    device_id: String,
}

#[derive(Deserialize)]
struct ImportEnvelope {
    #[serde(default)]
    desktop_sessions: Vec<ImportSession>,
}

#[derive(Deserialize)]
struct ImportSession {
    #[serde(default)]
    id: Option<String>,
    app: String,
    title: String,
    start_utc: i64,
    end_utc: i64,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    device_id: Option<String>,
}

fn cors_headers() -> Vec<Header> {
    vec![
        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET, POST, OPTIONS"[..]).unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Content-Type"[..]).unwrap(),
    ]
}

fn handle_request(mut request: tiny_http::Request) -> Result<()> {
    let url = request.url().to_string();
    let method = request.method().clone();

    // 1. CORS Preflight
    if method == Method::Options {
        let mut response = Response::empty(204);
        for h in cors_headers() {
            response.add_header(h);
        }
        request.respond(response).context("Failed to send OPTIONS response")?;
        return Ok(());
    }

    // 2. POST /api/import
    if method == Method::Post && url.starts_with("/api/import") {
        let mut body = String::new();
        let reader = request.as_reader();
        reader.read_to_string(&mut body).context("Failed to read body")?;

        let sessions: Vec<ImportSession> = if let Ok(envelope) = serde_json::from_str::<ImportEnvelope>(&body) {
            envelope.desktop_sessions
        } else if let Ok(arr) = serde_json::from_str::<Vec<ImportSession>>(&body) {
            arr
        } else {
            let mut response = Response::from_string("{\"error\":\"Invalid JSON payload\"}").with_status_code(400);
            for h in cors_headers() {
                response.add_header(h);
            }
            response.add_header(Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap());
            request.respond(response).context("Failed to send 400 response")?;
            return Ok(());
        };

        let conn = crate::db::open_reader_conn()?;
        let device_id = crate::db::get_or_create_device_id().unwrap_or_else(|_| "unknown".to_string());

        let mut imported = 0usize;
        {
            let mut stmt = conn.prepare(
                "INSERT OR IGNORE INTO sessions (id, app, title, start_utc, end_utc, source, device_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )?;
            for s in &sessions {
                let id = s.id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                let source = s.source.clone().unwrap_or_else(|| "imported".to_string());
                let dev = s.device_id.clone().unwrap_or_else(|| device_id.clone());
                let res = stmt.execute(rusqlite::params![id, s.app, s.title, s.start_utc, s.end_utc, source, dev])?;
                imported += res;
            }
        }

        let json_data = format!("{{\"status\":\"ok\",\"imported\":{}}}", imported);
        let mut response = Response::from_string(json_data);
        for h in cors_headers() {
            response.add_header(h);
        }
        response.add_header(Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap());
        request.respond(response).context("Failed to send import response")?;
        return Ok(());
    }

    // 3. GET /api/sessions
    if method != Method::Get || !url.starts_with("/api/sessions") {
        let mut response = Response::from_string("Not Found").with_status_code(404);
        for h in cors_headers() {
            response.add_header(h);
        }
        request.respond(response).context("Failed to send 404 response")?;
        return Ok(());
    }

    // Parse 'since' parameter
    let mut since: Option<i64> = None;
    if let Some(pos) = url.find("since=") {
        let param_val = &url[pos + 6..];
        let val_str = param_val.split('&').next().unwrap_or(param_val);
        if let Ok(parsed) = val_str.parse::<i64>() {
            since = Some(parsed);
        }
    }

    // If not provided, default to last 24 hours
    let since_val = since.unwrap_or_else(|| {
        let current_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        current_time - (24 * 60 * 60 * 1000) // last 24h in ms
    });

    // Open a new read-only DB connection
    let conn = crate::db::open_reader_conn()?;

    // Query sessions
    let mut stmt = conn
        .prepare(
            "SELECT id, app, title, start_utc, end_utc, source, device_id 
         FROM sessions 
         WHERE end_utc > ?1 
         ORDER BY start_utc ASC",
        )
        .context("Failed to prepare query sessions statement")?;

    let session_iter = stmt
        .query_map([since_val], |row| {
            Ok(Session {
                id: row.get(0)?,
                app: row.get(1)?,
                title: row.get(2)?,
                start_utc: row.get(3)?,
                end_utc: row.get(4)?,
                source: row.get(5)?,
                device_id: row.get(6)?,
            })
        })
        .context("Failed to execute sessions query")?;

    let mut sessions = Vec::new();
    for session in session_iter {
        sessions.push(session?);
    }

    // Serialize to JSON
    let json_data =
        serde_json::to_string(&sessions).context("Failed to serialize sessions to JSON")?;

    // Send response
    let mut response = Response::from_string(json_data);
    for h in cors_headers() {
        response.add_header(h);
    }
    response.add_header(Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap());

    request
        .respond(response)
        .context("Failed to send sessions response")?;

    Ok(())
}

pub fn run_server(shutdown: Arc<AtomicBool>) -> Result<()> {
    let ports = [5566, 5567, 5568];
    let mut server = None;

    for &port in &ports {
        let addr = format!("127.0.0.1:{}", port);
        match Server::http(&addr) {
            Ok(s) => {
                log::info!("REST API server listening on {}", addr);
                server = Some(s);
                break;
            }
            Err(e) => {
                log::warn!("Port {} unavailable ({}). Trying fallback port...", port, e);
            }
        }
    }

    let server = server.ok_or_else(|| anyhow::anyhow!("Failed to start tiny_http server on ports 5566-5568"))?;

    while !shutdown.load(Ordering::Relaxed) {
        match server.try_recv() {
            Ok(Some(request)) => {
                std::thread::spawn(move || {
                    if let Err(e) = handle_request(request) {
                        log::error!("Error handling request: {:?}", e);
                    }
                });
            }
            Ok(None) => {
                thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                log::error!("Server receive error: {:?}", e);
                thread::sleep(Duration::from_millis(50));
            }
        }
    }

    Ok(())
}

// Re-export Duration for the sleep calls
use std::time::Duration;
