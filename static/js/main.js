let peerConnection;
let localStream;
const mqtt_client = mqtt.connect('wss://broker.emqx.io:8084/mqtt');
let myId = null;
let currentCall = {
    destinationId: null,
    isInitiator: false
};

// Logging function
function log(type, message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type}] ${message}`);
}

// MQTT connection logging
mqtt_client.on('connect', () => {
    log('MQTT', 'Connected to MQTT broker');
});

mqtt_client.on('error', (error) => {
    log('MQTT_ERROR', `Connection error: ${error.message}`);
});

mqtt_client.on('close', () => {
    log('MQTT', 'Connection closed');
});

// Setup koneksi awal
function setupConnection() {
    myId = document.getElementById('myId').value;
    if (!myId) return alert('Masukkan ID Anda');

    log('SETUP', `Setting up connection for user ID: ${myId}`);
    
    // Subscribe ke topic pribadi
    mqtt_client.subscribe(`vchat/${myId}`, (err) => {
        if (err) {
            log('MQTT_ERROR', `Failed to subscribe: ${err.message}`);
        } else {
            log('MQTT', `Subscribed to topic: vchat/${myId}`);
        }
    });
    
    document.getElementById('setup').classList.add('hidden');
    document.getElementById('caller').classList.remove('hidden');
    document.getElementById('myIdDisplay').textContent = myId;
}

// Inisiasi panggilan
async function initiateCall() {
    const destinationId = document.getElementById('destinationId').value;
    if (!destinationId) return alert('Masukkan ID Tujuan');

    log('CALL', `Initiating call to: ${destinationId}`);
    currentCall.destinationId = destinationId;
    currentCall.isInitiator = true;

    // Kirim permintaan panggilan
    mqtt_client.publish(`vchat/${destinationId}`, JSON.stringify({
        type: 'call_request',
        from: myId
    }), (err) => {
        if (err) {
            log('MQTT_ERROR', `Failed to send call request: ${err.message}`);
        } else {
            log('MQTT', `Call request sent to: ${destinationId}`);
        }
    });
}

// Terima panggilan
async function acceptCall() {
    log('CALL', `Accepting call from: ${currentCall.destinationId}`);
    document.getElementById('callNotification').classList.add('hidden');
    document.getElementById('videos').classList.remove('hidden');

    try {
        log('MEDIA', 'Requesting media access...');
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        log('MEDIA', 'Media access granted');
        document.getElementById('localVideo').srcObject = localStream;

        createPeerConnection();

        if (!currentCall.isInitiator) {
            log('SIGNALING', 'Sending call accepted signal');
            mqtt_client.publish(`vchat/${currentCall.destinationId}`, JSON.stringify({
                type: 'call_accepted',
                from: myId
            }));
        }
    } catch (err) {
        log('ERROR', `Media access error: ${err.message}`);
        alert('Gagal mengakses kamera/mikrofon');
    }
}

function createPeerConnection() {
    log('WEBRTC', 'Creating peer connection');
    peerConnection = new RTCPeerConnection({ iceServers });

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            log('ICE', `New ICE candidate: ${JSON.stringify(event.candidate)}`);
            mqtt_client.publish(`vchat/${currentCall.destinationId}`, JSON.stringify({
                type: 'candidate',
                candidate: event.candidate
            }));
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        log('ICE', `Connection state changed: ${peerConnection.iceConnectionState}`);
    };

    peerConnection.onconnectionstatechange = () => {
        log('WEBRTC', `Connection state: ${peerConnection.connectionState}`);
    };

    peerConnection.onsignalingstatechange = () => {
        log('WEBRTC', `Signaling state: ${peerConnection.signalingState}`);
    };

    peerConnection.ontrack = event => {
        log('MEDIA', 'Received remote track');
        document.getElementById('remoteVideo').srcObject = event.streams[0];
    };

    localStream.getTracks().forEach(track => {
        log('MEDIA', `Adding local track: ${track.kind}`);
        peerConnection.addTrack(track, localStream);
    });
}

// MQTT message handler
mqtt_client.on('message', async (topic, message) => {
    const msg = JSON.parse(message.toString());
    log('MQTT', `Received message type: ${msg.type} from: ${msg.from || 'unknown'}`);

    switch(msg.type) {
        case 'call_request':
            log('CALL', `Incoming call from: ${msg.from}`);
            currentCall.destinationId = msg.from;
            document.getElementById('callerId').textContent = msg.from;
            document.getElementById('callNotification').classList.remove('hidden');
            break;

        case 'call_accepted':
            if (currentCall.isInitiator) {
                log('CALL', 'Call accepted, creating offer');
                document.getElementById('videos').classList.remove('hidden');
                try {
                    localStream = await navigator.mediaDevices.getUserMedia({
                        video: true,
                        audio: true
                    });
                    document.getElementById('localVideo').srcObject = localStream;
                    
                    createPeerConnection();
                    const offer = await peerConnection.createOffer();
                    await peerConnection.setLocalDescription(offer);
                    log('WEBRTC', 'Local description set, sending offer');
                    
                    mqtt_client.publish(`vchat/${currentCall.destinationId}`, JSON.stringify({
                        type: 'offer',
                        sdp: offer,
                        from: myId
                    }));
                } catch (err) {
                    log('ERROR', `Error in call acceptance: ${err.message}`);
                }
            }
            break;

        case 'offer':
            log('WEBRTC', 'Received offer, creating answer');
            await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            mqtt_client.publish(`vchat/${msg.from}`, JSON.stringify({
                type: 'answer',
                sdp: answer,
                from: myId
            }));
            log('WEBRTC', 'Answer sent');
            break;

        case 'answer':
            log('WEBRTC', 'Received answer');
            await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            break;

        case 'candidate':
            if (peerConnection) {
                log('ICE', 'Adding ICE candidate');
                await peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
            }
            break;

        case 'call_rejected':
            log('CALL', 'Call rejected');
            alert('Panggilan ditolak');
            resetCall();
            break;
    }
});

function endCall() {
    log('CALL', 'Ending call');
    if (localStream) {
        localStream.getTracks().forEach(track => {
            log('MEDIA', `Stopping track: ${track.kind}`);
            track.stop();
        });
    }
    if (peerConnection) {
        log('WEBRTC', 'Closing peer connection');
        peerConnection.close();
    }
    resetCall();
    document.getElementById('videos').classList.add('hidden');
    document.getElementById('caller').classList.remove('hidden');
}

function resetCall() {
    log('CALL', 'Resetting call state');
    currentCall = {
        destinationId: null,
        isInitiator: false
    };
}
