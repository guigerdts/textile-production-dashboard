use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: include_str!("../migrations/001_initial_schema.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "unique_orden_sequence",
            sql: include_str!("../migrations/002_lectura_orden_sequence_unique.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "d1_orden_persistence",
            sql: include_str!("../migrations/003_d1_orden_persistence.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "operational_events",
            sql: include_str!("../migrations/004_operational_events.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:estampado.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
