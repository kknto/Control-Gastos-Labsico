from flask import Flask, jsonify, request, send_from_directory
import os
import db

app = Flask(__name__, static_folder='.', static_url_path='')

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

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/api/transactions', methods=['GET'])
def get_transactions():
    return jsonify(db.get_transactions())

@app.route('/api/transactions', methods=['POST'])
def create_transaction():
    data = request.json
    new_id = db.add_transaction(data)
    data['id'] = new_id
    return jsonify(data), 201

@app.route('/api/transactions/<int:id>', methods=['PUT'])
def update_transaction(id):
    data = request.json
    db.update_transaction(id, data)
    return jsonify({'success': True})

@app.route('/api/transactions/<int:id>', methods=['DELETE'])
def delete_transaction(id):
    db.delete_transaction(id)
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

@app.route('/api/services/<int:id>', methods=['PUT'])
def update_service(id):
    data = normalize_service_in(request.json)
    db.update_service(id, data)
    return jsonify({'success': True})

@app.route('/api/services/<int:id>', methods=['DELETE'])
def delete_service(id):
    db.delete_service(id)
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

@app.route('/api/sheets/<int:id>', methods=['DELETE'])
def delete_sheet(id):
    db.delete_sheet(id)
    return jsonify({'success': True})

@app.route('/api/sheets/<int:id>/rows', methods=['GET'])
def get_sheet_rows(id):
    return jsonify(db.get_sheet_rows(id))

@app.route('/api/sheet-rows', methods=['POST'])
def add_sheet_row():
    data = request.json
    new_id = db.add_sheet_row(data)
    data['id'] = new_id
    return jsonify(data), 201

@app.route('/api/sheet-rows/<int:id>', methods=['PUT'])
def update_sheet_row(id):
    data = request.json
    db.update_sheet_row(id, data)
    return jsonify({'success': True})

@app.route('/api/sheet-rows/<int:id>', methods=['DELETE'])
def delete_sheet_row(id):
    db.delete_sheet_row(id)
    return jsonify({'success': True})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = not os.environ.get('DATABASE_URL')  # False en producción
    print(f"Servidor corriendo en http://localhost:{port}")
    print("Presiona Ctrl+C para detenerlo.")
    app.run(debug=debug, port=port)
