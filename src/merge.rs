use anyhow::{Context, Result};
use rusqlite::{Connection, params};
use uuid::Uuid;

pub fn record_session(
    conn: &Connection,
    device_id: &str,
    app: &str,
    title: &str,
    source: &str,
    ts: i64,
) -> Result<()> {
    let mut stmt = conn
        .prepare(
            "SELECT id, app, title, start_utc, end_utc, source 
         FROM sessions 
         ORDER BY end_utc DESC LIMIT 1",
        )
        .context("Failed to prepare last session query")?;

    let last_row = stmt.query_row([], |row| {
        Ok((
            row.get::<_, String>(0)?, // id
            row.get::<_, String>(1)?, // app
            row.get::<_, String>(2)?, // title
            row.get::<_, i64>(3)?,    // start_utc
            row.get::<_, i64>(4)?,    // end_utc
            row.get::<_, String>(5)?, // source
        ))
    });

    match last_row {
        Ok((id, last_app, last_title, _start_utc, end_utc, last_source)) => {
            let gap = ts - end_utc;
            if last_app == app
                && last_title == title
                && last_source == source
                && (0..=9000).contains(&gap)
            {
                conn.execute(
                    "UPDATE sessions SET end_utc = ?1 WHERE id = ?2",
                    params![ts, id],
                )
                .context("Failed to update session end_utc")?;
            } else {
                let new_id = Uuid::now_v7().to_string();
                conn.execute(
                    "INSERT INTO sessions (id, app, title, start_utc, end_utc, source, device_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![new_id, app, title, ts, ts, source, device_id],
                )
                .context("Failed to insert new session")?;
            }
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            let new_id = Uuid::now_v7().to_string();
            conn.execute(
                "INSERT INTO sessions (id, app, title, start_utc, end_utc, source, device_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![new_id, app, title, ts, ts, source, device_id],
            )
            .context("Failed to insert first session")?;
        }
        Err(e) => {
            return Err(e).context("Error querying last session");
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                app TEXT NOT NULL,
                title TEXT NOT NULL,
                start_utc INTEGER NOT NULL,
                end_utc INTEGER NOT NULL,
                source TEXT NOT NULL,
                device_id TEXT NOT NULL
            );",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_record_first_session() {
        let conn = setup_test_db();
        record_session(&conn, "dev-1", "Code.exe", "main.rs", "foreground", 1000).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);

        let (start, end): (i64, i64) = conn
            .query_row(
                "SELECT start_utc, end_utc FROM sessions WHERE app = 'Code.exe'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(start, 1000);
        assert_eq!(end, 1000);
    }

    #[test]
    fn test_merge_heartbeat_within_gap() {
        let conn = setup_test_db();
        record_session(&conn, "dev-1", "Code.exe", "main.rs", "foreground", 1000).unwrap();
        // 3 seconds later: same app and title
        record_session(&conn, "dev-1", "Code.exe", "main.rs", "foreground", 4000).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "Should merge into existing session");

        let (start, end): (i64, i64) = conn
            .query_row(
                "SELECT start_utc, end_utc FROM sessions WHERE app = 'Code.exe'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(start, 1000);
        assert_eq!(end, 4000);
    }

    #[test]
    fn test_split_session_on_gap_exceeded() {
        let conn = setup_test_db();
        record_session(&conn, "dev-1", "Code.exe", "main.rs", "foreground", 1000).unwrap();
        // 15 seconds later (> 9000ms gap)
        record_session(&conn, "dev-1", "Code.exe", "main.rs", "foreground", 16000).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            count, 2,
            "Should create new session after gap exceeds limit"
        );
    }

    #[test]
    fn test_split_session_on_app_change() {
        let conn = setup_test_db();
        record_session(&conn, "dev-1", "Code.exe", "main.rs", "foreground", 1000).unwrap();
        record_session(&conn, "dev-1", "chrome.exe", "Google", "foreground", 2000).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2, "Should create separate session for different app");
    }
}
