import os
import time
from datetime import timedelta

from flask import Flask, jsonify, redirect, request, send_from_directory, session, url_for
from werkzeug.security import check_password_hash

import db

DEFAULT_ADMIN_USERNAME = os.environ.get('ADMIN_USERNAME', 'admin.labsico')
DEFAULT_ADMIN_PASSWORD_HASH = os.environ.get(
    'ADMIN_PASSWORD_HASH',
    'scrypt:32768:8:1$EVoco5zwwzEZlwSf$b54b0d20afc72314f59b4720a2612f58bf6801d7842930d44554ca4e9cfa2ea3b29cba8594731a96e5ae735ea02560ef917d98ca8594ab95d663f70db42404ff',
)
LOGIN_WINDOW_SECONDS = 10 * 60
LOGIN_MAX_ATTEMPTS = 5
PUBLIC_PATHS = {
    '/health',
    '/login',
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/session',
}
PUBLIC_PREFIXES = (
    '/css/',
    '/js/',
    '/favicon.ico',
)

login_attempts = {}

app = Flask(__name__, static_folder='.', static_url_path='')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY') or os.environ.get('FLASK_SECRET_KEY') or DEFAULT_ADMIN_PASSWORD_HASH
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = bool(os.environ.get('DATABASE_URL'))
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=12)

# Initialise DB when the module loads (works with both `python server.py`
# and gunicorn, which does not execute the __main__ block).
db.init_db()


def normalize_service_in(payload):
    data = dict(payload or {})
    if 'payment_status' not in data:
        data['payment_status'] = data.get('status', 'pendiente')
    if 'next_payment_date' not in data:
        data['next_payment_date'] = data.get('next_billing_date', '')
    return data


def normalize_service_out(payload):
    data = dict(payload or {})
    if 'status' not in data:
        data['status'] = data.get('payment_status')
    if 'next_billing_date' not in data:
        data['next_billing_date'] = data.get('next_payment_date')
    return data


def get_client_key():
    forwarded_for = request.headers.get('X-Forwarded-For', '')
    if forwarded_for:
        return forwarded_for.split(',')[0].strip()
    return request.remote_addr or 'unknown'


def cleanup_login_attempts():
    now = time.time()
    expired_keys = [
        key for key, entry in login_attempts.items()
        if now - entry.get('first_attempt', now) > LOGIN_WINDOW_SECONDS
    ]
    for key in expired_keys:
        login_attempts.pop(key, None)


def is_login_blocked(client_key):
    cleanup_login_attempts()
    entry = login_attempts.get(client_key)
    if not entry:
        return False, 0
    if entry.get('count', 0) < LOGIN_MAX_ATTEMPTS:
        return False, 0
    retry_after = int(LOGIN_WINDOW_SECONDS - (time.time() - entry['first_attempt']))
    return retry_after > 0, max(retry_after, 0)


def register_login_failure(client_key):
    now = time.time()
    entry = login_attempts.get(client_key)
    if not entry or now - entry.get('first_attempt', now) > LOGIN_WINDOW_SECONDS:
        login_attempts[client_key] = {'count': 1, 'first_attempt': now}
        return
    entry['count'] += 1


def clear_login_failures(client_key):
    login_attempts.pop(client_key, None)


def is_authenticated():
    return bool(session.get('user'))


def current_user_payload():
    user = session.get('user')
    if not user:
        return None
    return {
        'username': user.get('username', DEFAULT_ADMIN_USERNAME),
        'name': user.get('name', 'Administrador'),
        'role': user.get('role', 'admin'),
    }


def is_public_request(path):
    if path in PUBLIC_PATHS:
        return True
    return any(path.startswith(prefix) for prefix in PUBLIC_PREFIXES)


def unauthorized_response():
    if request.path.startswith('/api/'):
        return jsonify({'error': 'authentication_required'}), 401
    return redirect(url_for('login'))


@app.before_request
def require_authentication():
    if is_public_request(request.path):
        return None
    if is_authenticated():
        return None
    return unauthorized_response()


@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


@app.route('/login')
def login():
    if is_authenticated():
        return redirect(url_for('index'))
    return send_from_directory('.', 'login.html')


@app.route('/health')
def health():
    ok = db.ping()
    status = 200 if ok else 503
    return jsonify({
        'ok': ok,
        'database': 'postgres' if os.environ.get('DATABASE_URL') else 'sqlite',
    }), status


@app.route('/api/auth/login', methods=['POST'])
def login_api():
    client_key = get_client_key()
    blocked, retry_after = is_login_blocked(client_key)
    if blocked:
        return jsonify({
            'error': 'too_many_attempts',
            'retry_after_seconds': retry_after,
        }), 429

    payload = request.get_json(silent=True) or {}
    username = str(payload.get('username', '')).strip()
    password = str(payload.get('password', ''))

    is_valid = username == DEFAULT_ADMIN_USERNAME and check_password_hash(DEFAULT_ADMIN_PASSWORD_HASH, password)
    if not is_valid:
        register_login_failure(client_key)
        return jsonify({'error': 'invalid_credentials'}), 401

    clear_login_failures(client_key)
    session.permanent = True
    session['user'] = {
        'username': DEFAULT_ADMIN_USERNAME,
        'name': 'Administrador',
        'role': 'admin',
    }
    return jsonify({'success': True, 'user': current_user_payload()})


@app.route('/api/auth/logout', methods=['POST'])
def logout_api():
    session.clear()
    return jsonify({'success': True})


@app.route('/api/auth/session', methods=['GET'])
def session_api():
    return jsonify({
        'authenticated': is_authenticated(),
        'user': current_user_payload(),
    })


@app.route('/api/transactions', methods=['GET'])
def get_transactions():
    return jsonify(db.get_transactions())


@app.route('/api/transactions', methods=['POST'])
def create_transaction():
    data = request.json
    new_id = db.add_transaction(data)
    data['id'] = new_id
    return jsonify(data), 201


@app.route('/api/transactions/<int:tx_id>', methods=['PUT'])
def update_transaction(tx_id):
    data = request.json
    db.update_transaction(tx_id, data)
    return jsonify({'success': True})


@app.route('/api/transactions/<int:tx_id>', methods=['DELETE'])
def delete_transaction(tx_id):
    db.delete_transaction(tx_id)
    return jsonify({'success': True})


@app.route('/api/transactions/bulk', methods=['DELETE'])
def delete_transactions_bulk():
    ids = request.json.get('ids', [])
    if ids:
        db.delete_transactions_bulk(ids)
    return jsonify({'success': True})


@app.route('/api/settings', methods=['GET'])
def get_settings():
    return jsonify(db.get_settings())


@app.route('/api/settings/<key>', methods=['POST'])
def save_setting(key):
    value = request.json
    db.update_setting(key, value)
    return jsonify({'success': True})


@app.route('/api/services', methods=['GET'])
def get_services():
    services = [normalize_service_out(s) for s in db.get_services()]
    return jsonify(services)


@app.route('/api/services', methods=['POST'])
def add_service():
    data = normalize_service_in(request.json)
    new_id = db.add_service(data)
    data['id'] = new_id
    return jsonify(normalize_service_out(data)), 201


@app.route('/api/services/<int:service_id>', methods=['PUT'])
def update_service(service_id):
    data = normalize_service_in(request.json)
    db.update_service(service_id, data)
    return jsonify({'success': True})


@app.route('/api/services/<int:service_id>', methods=['DELETE'])
def delete_service(service_id):
    db.delete_service(service_id)
    return jsonify({'success': True})


@app.route('/api/sheets', methods=['GET'])
def get_sheets():
    return jsonify(db.get_sheets())


@app.route('/api/sheets', methods=['POST'])
def create_sheet():
    data = request.json
    new_id = db.create_sheet(data)
    data['id'] = new_id
    return jsonify(data), 201


@app.route('/api/sheets/<int:sheet_id>', methods=['DELETE'])
def delete_sheet(sheet_id):
    db.delete_sheet(sheet_id)
    return jsonify({'success': True})


@app.route('/api/sheets/<int:sheet_id>/rows', methods=['GET'])
def get_sheet_rows(sheet_id):
    return jsonify(db.get_sheet_rows(sheet_id))


@app.route('/api/sheet-rows', methods=['POST'])
def add_sheet_row():
    data = request.json
    new_id = db.add_sheet_row(data)
    data['id'] = new_id
    return jsonify(data), 201


@app.route('/api/sheet-rows/<int:row_id>', methods=['PUT'])
def update_sheet_row(row_id):
    data = request.json
    db.update_sheet_row(row_id, data)
    return jsonify({'success': True})


@app.route('/api/sheet-rows/<int:row_id>', methods=['DELETE'])
def delete_sheet_row(row_id):
    db.delete_sheet_row(row_id)
    return jsonify({'success': True})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = not os.environ.get('DATABASE_URL')
    print(f"Servidor corriendo en http://localhost:{port}")
    print("Presiona Ctrl+C para detenerlo.")
    app.run(debug=debug, port=port)
