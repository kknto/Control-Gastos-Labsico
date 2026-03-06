import json
import os

DATABASE_URL = os.environ.get('DATABASE_URL')

# -------------------------------------------------------------------
# Connection helpers
# -------------------------------------------------------------------

def _is_postgres():
    return bool(DATABASE_URL)


def get_db_connection():
    if _is_postgres():
        import psycopg2
        import psycopg2.extras
        # Render provides URLs starting with 'postgres://' but psycopg2
        # requires 'postgresql://'
        url = DATABASE_URL
        if url.startswith('postgres://'):
            url = 'postgresql://' + url[len('postgres://'):]
        conn = psycopg2.connect(url)
        conn.autocommit = False
        return conn
    else:
        import sqlite3
        conn = sqlite3.connect('finance.db')
        conn.row_factory = sqlite3.Row
        return conn


def _cursor(conn):
    """Return a cursor; for Postgres use RealDictCursor for dict-like rows."""
    if _is_postgres():
        import psycopg2.extras
        return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    return conn.cursor()


def _placeholder():
    """Return the parameter placeholder for the current DB driver."""
    return '%s' if _is_postgres() else '?'


def _fetchall_as_dicts(cursor):
    rows = cursor.fetchall()
    if _is_postgres():
        return [dict(r) for r in rows]
    return [dict(r) for r in rows]


def _fetchone_as_dict(cursor):
    row = cursor.fetchone()
    if row is None:
        return None
    return dict(row)


def _execute(conn, sql, params=()):
    """Execute a parameterized query, adapting placeholder style."""
    if not _is_postgres():
        sql = sql.replace('%s', '?')
    c = _cursor(conn)
    c.execute(sql, params)
    return c


# -------------------------------------------------------------------
# Schema initialisation
# -------------------------------------------------------------------

def init_db():
    conn = get_db_connection()
    c = _cursor(conn)

    if _is_postgres():
        # Postgres DDL uses SERIAL instead of INTEGER PRIMARY KEY AUTOINCREMENT
        c.execute('''
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                date TEXT NOT NULL,
                category TEXT NOT NULL,
                concept TEXT NOT NULL,
                amount REAL NOT NULL,
                type TEXT NOT NULL,
                status TEXT NOT NULL,
                subtotal REAL,
                iva REAL
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS services (
                id SERIAL PRIMARY KEY,
                client_name TEXT NOT NULL,
                service_type TEXT NOT NULL,
                monthly_amount REAL NOT NULL,
                payment_status TEXT NOT NULL,
                next_payment_date TEXT NOT NULL,
                description TEXT
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS sheets (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                notes TEXT
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS sheet_rows (
                id SERIAL PRIMARY KEY,
                sheet_id INTEGER NOT NULL,
                concept TEXT NOT NULL,
                amount REAL NOT NULL,
                notes TEXT,
                parent_id INTEGER,
                sort_order INTEGER,
                FOREIGN KEY (sheet_id) REFERENCES sheets (id) ON DELETE CASCADE
            )
        ''')
        # Postgres migrations (ADD COLUMN IF NOT EXISTS is available in PG 9.6+)
        for col, coltype in [
            ('subtotal', 'REAL'), ('iva', 'REAL')
        ]:
            try:
                c.execute(f'ALTER TABLE transactions ADD COLUMN IF NOT EXISTS {col} {coltype}')
            except Exception:
                pass
        for col, coltype in [
            ('parent_id', 'INTEGER'), ('sort_order', 'INTEGER')
        ]:
            try:
                c.execute(f'ALTER TABLE sheet_rows ADD COLUMN IF NOT EXISTS {col} {coltype}')
            except Exception:
                pass

    else:
        import sqlite3
        c.execute('''
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                category TEXT NOT NULL,
                concept TEXT NOT NULL,
                amount REAL NOT NULL,
                type TEXT NOT NULL,
                status TEXT NOT NULL,
                subtotal REAL,
                iva REAL
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_name TEXT NOT NULL,
                service_type TEXT NOT NULL,
                monthly_amount REAL NOT NULL,
                payment_status TEXT NOT NULL,
                next_payment_date TEXT NOT NULL,
                description TEXT
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS sheets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                notes TEXT
            )
        ''')
        c.execute('''
            CREATE TABLE IF NOT EXISTS sheet_rows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sheet_id INTEGER NOT NULL,
                concept TEXT NOT NULL,
                amount REAL NOT NULL,
                notes TEXT,
                parent_id INTEGER,
                sort_order INTEGER,
                FOREIGN KEY (sheet_id) REFERENCES sheets (id) ON DELETE CASCADE
            )
        ''')
        for col in ['parent_id', 'subtotal', 'iva', 'sort_order']:
            try:
                c.execute(f'SELECT {col} FROM sheet_rows LIMIT 1')
            except sqlite3.OperationalError:
                c.execute(f'ALTER TABLE sheet_rows ADD COLUMN {col} INTEGER')
        for col in ['subtotal', 'iva']:
            try:
                c.execute(f'SELECT {col} FROM transactions LIMIT 1')
            except sqlite3.OperationalError:
                c.execute(f'ALTER TABLE transactions ADD COLUMN {col} REAL')

    # Initialize sort_order for existing rows
    try:
        c.execute('UPDATE sheet_rows SET sort_order = id WHERE sort_order IS NULL')
    except Exception:
        pass

    # Default settings
    default_categories = ['Ventas', 'Nómina', 'Renta', 'Impuestos (IVA/ISR)',
                          'Cuotas (IMSS/INFONAVIT)', 'Vehículos', 'Servicios', 'Otros']
    default_fixed = {
        'payrollWeekly': 38600,
        'trucksMonthly': 29235,
        'servicesMonthly': 3000,
        'rentMonthly': 25000,
        'taxesMonthly': 0
    }
    p = _placeholder()
    c.execute(f"SELECT 1 FROM settings WHERE key = {p}", ('categories',))
    if not c.fetchone():
        c.execute(f'INSERT INTO settings (key, value) VALUES ({p}, {p})',
                  ('categories', json.dumps(default_categories)))
    c.execute(f"SELECT 1 FROM settings WHERE key = {p}", ('fixedCosts',))
    if not c.fetchone():
        c.execute(f'INSERT INTO settings (key, value) VALUES ({p}, {p})',
                  ('fixedCosts', json.dumps(default_fixed)))

    conn.commit()
    conn.close()


# -------------------------------------------------------------------
# Transactions
# -------------------------------------------------------------------

def get_transactions():
    conn = get_db_connection()
    c = _execute(conn, 'SELECT * FROM transactions ORDER BY date DESC')
    rows = _fetchall_as_dicts(c)
    conn.close()
    return rows


def add_transaction(data):
    conn = get_db_connection()
    p = _placeholder()
    sql = (f'INSERT INTO transactions (date, category, concept, amount, type, status, subtotal, iva) '
           f'VALUES ({p},{p},{p},{p},{p},{p},{p},{p})')
    if _is_postgres():
        sql += ' RETURNING id'
    c = _execute(conn, sql,
                 (data['date'], data['category'], data['concept'], data['amount'],
                  data['type'], data['status'], data.get('subtotal'), data.get('iva')))
    if _is_postgres():
        new_id = c.fetchone()['id']
    else:
        new_id = c.lastrowid
    conn.commit()
    conn.close()
    return new_id


def update_transaction(id, data):
    conn = get_db_connection()
    p = _placeholder()
    _execute(conn,
             f'UPDATE transactions SET date={p},category={p},concept={p},amount={p},'
             f'type={p},status={p},subtotal={p},iva={p} WHERE id={p}',
             (data['date'], data['category'], data['concept'], data['amount'],
              data['type'], data['status'], data.get('subtotal'), data.get('iva'), id))
    conn.commit()
    conn.close()


def delete_transaction(id):
    conn = get_db_connection()
    p = _placeholder()
    _execute(conn, f'DELETE FROM transactions WHERE id={p}', (id,))
    conn.commit()
    conn.close()


def delete_transactions_bulk(ids):
    if not ids:
        return
    conn = get_db_connection()
    p = _placeholder()
    placeholders = ','.join([p] * len(ids))
    _execute(conn, f'DELETE FROM transactions WHERE id IN ({placeholders})', ids)
    conn.commit()
    conn.close()


# -------------------------------------------------------------------
# Settings
# -------------------------------------------------------------------

def get_settings():
    conn = get_db_connection()
    c = _execute(conn, 'SELECT * FROM settings')
    rows = _fetchall_as_dicts(c)
    conn.close()
    return {r['key']: json.loads(r['value']) for r in rows}


def update_setting(key, value):
    conn = get_db_connection()
    p = _placeholder()
    if _is_postgres():
        _execute(conn,
                 f'INSERT INTO settings (key, value) VALUES ({p},{p}) '
                 f'ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
                 (key, json.dumps(value)))
    else:
        _execute(conn,
                 f'INSERT OR REPLACE INTO settings (key, value) VALUES ({p},{p})',
                 (key, json.dumps(value)))
    conn.commit()
    conn.close()


# -------------------------------------------------------------------
# Services
# -------------------------------------------------------------------

def get_services():
    conn = get_db_connection()
    c = _execute(conn, 'SELECT * FROM services ORDER BY next_payment_date ASC')
    rows = _fetchall_as_dicts(c)
    conn.close()
    return rows


def add_service(data):
    conn = get_db_connection()
    p = _placeholder()
    sql = (f'INSERT INTO services (client_name,service_type,monthly_amount,'
           f'payment_status,next_payment_date,description) '
           f'VALUES ({p},{p},{p},{p},{p},{p})')
    if _is_postgres():
        sql += ' RETURNING id'
    c = _execute(conn, sql,
                 (data['client_name'], data['service_type'], data['monthly_amount'],
                  data['payment_status'], data['next_payment_date'],
                  data.get('description', '')))
    if _is_postgres():
        new_id = c.fetchone()['id']
    else:
        new_id = c.lastrowid
    conn.commit()
    conn.close()
    return new_id


def update_service(id, data):
    conn = get_db_connection()
    p = _placeholder()
    _execute(conn,
             f'UPDATE services SET client_name={p},service_type={p},monthly_amount={p},'
             f'payment_status={p},next_payment_date={p},description={p} WHERE id={p}',
             (data['client_name'], data['service_type'], data['monthly_amount'],
              data['payment_status'], data['next_payment_date'],
              data.get('description', ''), id))
    conn.commit()
    conn.close()


def delete_service(id):
    conn = get_db_connection()
    p = _placeholder()
    _execute(conn, f'DELETE FROM services WHERE id={p}', (id,))
    conn.commit()
    conn.close()


# -------------------------------------------------------------------
# Sheets
# -------------------------------------------------------------------

def get_sheets():
    conn = get_db_connection()
    c = _execute(conn, 'SELECT * FROM sheets ORDER BY created_at DESC')
    rows = _fetchall_as_dicts(c)
    conn.close()
    return rows


def create_sheet(data):
    conn = get_db_connection()
    p = _placeholder()
    created_at = data.get('created_at') or '2026-01-21'
    sql = f'INSERT INTO sheets (title,created_at,notes) VALUES ({p},{p},{p})'
    if _is_postgres():
        sql += ' RETURNING id'
    c = _execute(conn, sql, (data['title'], created_at, data.get('notes', '')))
    if _is_postgres():
        new_id = c.fetchone()['id']
    else:
        new_id = c.lastrowid
    conn.commit()
    conn.close()
    return new_id


def delete_sheet(id):
    conn = get_db_connection()
    p = _placeholder()
    _execute(conn, f'DELETE FROM sheet_rows WHERE sheet_id={p}', (id,))
    _execute(conn, f'DELETE FROM sheets WHERE id={p}', (id,))
    conn.commit()
    conn.close()


# -------------------------------------------------------------------
# Sheet rows
# -------------------------------------------------------------------

def get_sheet_rows(sheet_id):
    conn = get_db_connection()
    p = _placeholder()
    c = _execute(conn,
                 f'SELECT * FROM sheet_rows WHERE sheet_id={p} ORDER BY sort_order, id',
                 (sheet_id,))
    rows = _fetchall_as_dicts(c)
    conn.close()
    return rows


def add_sheet_row(data):
    conn = get_db_connection()
    p = _placeholder()
    parent_id = data.get('parent_id')
    if parent_id is None:
        c = _execute(conn,
                     f'SELECT COALESCE(MAX(sort_order),0) AS mx FROM sheet_rows '
                     f'WHERE sheet_id={p} AND parent_id IS NULL',
                     (data['sheet_id'],))
    else:
        c = _execute(conn,
                     f'SELECT COALESCE(MAX(sort_order),0) AS mx FROM sheet_rows '
                     f'WHERE sheet_id={p} AND parent_id={p}',
                     (data['sheet_id'], parent_id))
    row = _fetchone_as_dict(c)
    next_order = (row['mx'] if row and row['mx'] else 0) + 1

    sql = (f'INSERT INTO sheet_rows (sheet_id,concept,amount,notes,parent_id,sort_order) '
           f'VALUES ({p},{p},{p},{p},{p},{p})')
    if _is_postgres():
        sql += ' RETURNING id'
    c = _execute(conn, sql,
                 (data['sheet_id'], data['concept'], data['amount'],
                  data.get('notes', ''), parent_id, next_order))
    if _is_postgres():
        new_id = c.fetchone()['id']
    else:
        new_id = c.lastrowid
    conn.commit()
    conn.close()
    return new_id


def update_sheet_row(id, data):
    conn = get_db_connection()
    p = _placeholder()
    sort_order = data.get('sort_order')
    if sort_order is None:
        c = _execute(conn, f'SELECT sort_order FROM sheet_rows WHERE id={p}', (id,))
        existing = _fetchone_as_dict(c)
        sort_order = existing['sort_order'] if existing else None
    _execute(conn,
             f'UPDATE sheet_rows SET concept={p},amount={p},notes={p},parent_id={p},sort_order={p} WHERE id={p}',
             (data['concept'], data['amount'], data.get('notes', ''),
              data.get('parent_id'), sort_order, id))
    conn.commit()
    conn.close()


def delete_sheet_row(id):
    conn = get_db_connection()
    p = _placeholder()
    _execute(conn, f'DELETE FROM sheet_rows WHERE id={p}', (id,))
    conn.commit()
    conn.close()
