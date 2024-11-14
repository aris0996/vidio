from flask import Flask, render_template
import requests
import json

app = Flask(__name__)

# Xirsys credentials
xirsys_data = {
    "format": "urls",
    "ident": "Aris",
    "secret": "1526bef2-9dca-11ef-8d28-0242ac150002",
    "channel": "vchat",
    "secure": 1
}

# Fallback ICE servers
fallback_ice_servers = {
    "iceServers": [
        {
            "urls": [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302",
                "stun:stun2.l.google.com:19302"
            ]
        }
    ]
}

@app.route('/')
def index():
    try:
        url = 'https://global.xirsys.net/_turn/vchat'
        response = requests.post(url, data=json.dumps(xirsys_data), timeout=5)
        ice_servers = response.json().get('v', {}).get('iceServers')
        if not ice_servers:
            ice_servers = fallback_ice_servers["iceServers"]
    except Exception as e:
        print(f"Error connecting to Xirsys: {e}")
        ice_servers = fallback_ice_servers["iceServers"]
    
    return render_template('index.html', ice_servers=ice_servers)

# Tambahkan ini untuk Vercel
app.debug = False

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000) 