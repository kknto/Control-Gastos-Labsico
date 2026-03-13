import argparse
import os
import sqlite3
from typing import Iterable

import db

TABLE_CONFIG = [
    {
        'name': 'settings',
        'columns': ['key', 'value'],
        'conflict_key': 'key',
        'order_by': 'key',
    },
    {
        'name': 'transactions',
        'columns': ['id', 'date', 'category', 'concept', 'amount', 'type', 'status', 'subtotal', 'iva'],
        'conflict_key': 'id',
        'order_by': 'id',
    },
    {
        'name': 'services',
        'columns': ['id', 'client_name', 'service_type', 'monthly_amount', 'payment_status', 'next_payment_date', 'description'],
        'conflict_key': 'id',
        'order_by': 'id',
    },
    {
        'name': 'sheets',
        'columns': ['id', 'title', 'created_at', 'notes'],
        'conflict_key': 'id',
        'order_by': 'id',
    },
    {
        'name': 'sheet_rows',
        'columns': ['id', 'sheet_id', 'concept', 'amount', 'notes', 'parent_id', 'sort_order'],
        'conflict_key': 'id',
        'order_by': 'id',
    },
]


def parse_args():
    parser = argparse.ArgumentParser(
        description='Copy data from the local SQLite database into PostgreSQL.'
    )
    parser.add_argument(
        '--sqlite-path',
        default='finance.db',
        help='Path to the SQLite database file. Defaults to finance.db.',
    )
    parser.add_argument(
        '--database-url',
        default='',
        help='PostgreSQL connection string. Falls back to the DATABASE_URL env var.',
    )
    parser.add_argument(
        '--wipe-destination',
        action='store_true',
        help='Delete destination data before importing.',
    )
    return parser.parse_args()


def get_sqlite_connection(path: str):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def get_postgres_connection(database_url: str):
    import psycopg2

    url = database_url.strip()
    if url.startswith('postgres://'):
        url = 'postgresql://' + url[len('postgres://'):]
    return psycopg2.connect(url)


def fetch_rows(sqlite_conn, table_name: str, columns: Iterable[str], order_by: str):
    query = f"SELECT {', '.join(columns)} FROM {table_name} ORDER BY {order_by}"
    rows = sqlite_conn.execute(query).fetchall()
    return [tuple(row[col] for col in columns) for row in rows]


def wipe_destination(pg_conn):
    with pg_conn.cursor() as cur:
        cur.execute(
            'TRUNCATE TABLE sheet_rows, sheets, services, transactions, settings RESTART IDENTITY CASCADE'
        )
    pg_conn.commit()


def upsert_rows(pg_conn, table_name: str, columns: Iterable[str], conflict_key: str, rows):
    from psycopg2.extras import execute_values

    if not rows:
        return 0

    columns = list(columns)
    update_columns = [col for col in columns if col != conflict_key]
    assignments = ', '.join(f'{col} = EXCLUDED.{col}' for col in update_columns)
    sql = (
        f"INSERT INTO {table_name} ({', '.join(columns)}) VALUES %s "
        f'ON CONFLICT ({conflict_key}) DO UPDATE SET {assignments}'
    )

    with pg_conn.cursor() as cur:
        execute_values(cur, sql, rows, page_size=200)
    pg_conn.commit()
    return len(rows)


def sync_sequences(pg_conn):
    tables = ['transactions', 'services', 'sheets', 'sheet_rows']
    with pg_conn.cursor() as cur:
        for table_name in tables:
            cur.execute(
                f"""
                SELECT setval(
                    pg_get_serial_sequence('{table_name}', 'id'),
                    COALESCE((SELECT MAX(id) FROM {table_name}), 1),
                    (SELECT COUNT(*) > 0 FROM {table_name})
                )
                """
            )
    pg_conn.commit()


def main():
    args = parse_args()
    database_url = args.database_url or os.environ.get('DATABASE_URL', '').strip()

    if not os.path.exists(args.sqlite_path):
        raise SystemExit(f'SQLite database not found: {args.sqlite_path}')
    if not database_url:
        raise SystemExit('Provide --database-url or set DATABASE_URL before running the migration.')

    os.environ['DATABASE_URL'] = database_url
    db.init_db()

    sqlite_conn = get_sqlite_connection(args.sqlite_path)
    pg_conn = get_postgres_connection(database_url)

    try:
        if args.wipe_destination:
            wipe_destination(pg_conn)

        for table in TABLE_CONFIG:
            rows = fetch_rows(
                sqlite_conn,
                table['name'],
                table['columns'],
                table['order_by'],
            )
            copied = upsert_rows(
                pg_conn,
                table['name'],
                table['columns'],
                table['conflict_key'],
                rows,
            )
            print(f"{table['name']}: {copied} rows processed")

        sync_sequences(pg_conn)
        print('Migration completed successfully.')
    finally:
        sqlite_conn.close()
        pg_conn.close()


if __name__ == '__main__':
    main()
