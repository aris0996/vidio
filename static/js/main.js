let peerConnection;
let localStream;
const mqtt_client = mqtt.connect('wss://broker.emqx.io:8084/mqtt');
let myId = null;
let currentCall = {
    destinationId: null,
    isInitiator: false
};

// Tambahkan variabel untuk track status
let isAudioMuted = false;
let isVideoMuted = false;

// Fungsi logging yang lebih detail
function logDetail(type, message, data = null) {
    const timestamp = new Date().toISOString();
    const logStyle = {
        'MQTT': 'color: #2196F3',        // Biru
        'MQTT_ERROR': 'color: #F44336',  // Merah
        'SETUP': 'color: #4CAF50',       // Hijau
        'CALL': 'color: #9C27B0',        // Ungu
        'MEDIA': 'color: #FF9800',       // Orange
        'WEBRTC': 'color: #795548',      // Coklat
        'ICE': 'color: #00BCD4',         // Cyan
        'ERROR': 'color: #F44336',       // Merah
        'DEBUG': 'color: #9E9E9E'        // Abu-abu
    };

    const style = logStyle[type] || 'color: black';
    
    console.group(`%c[${timestamp}] [${type}]`, style);
    console.log(`Message: ${message}`);
    
    if (data) {
        console.log('Additional Data:', data);
    }

    // Log status koneksi jika relevan
    if (type === 'WEBRTC' || type === 'ICE') {
        if (peerConnection) {
            console.log('Connection States:', {
                iceConnectionState: peerConnection.iceConnectionState,
                connectionState: peerConnection.connectionState,
                signalingState: peerConnection.signalingState
            });
        }
    }

    // Log media tracks jika relevan
    if (type === 'MEDIA' && localStream) {
        const tracks = localStream.getTracks().map(track => ({
            kind: track.kind,
            enabled: track.enabled,
            muted: track.muted,
            id: track.id
        }));
        console.log('Media Tracks:', tracks);
    }

    console.groupEnd();
}

// MQTT connection logging
mqtt_client.on('connect', () => {
    logDetail('MQTT', 'Connected to MQTT broker', {
        clientId: mqtt_client.options.clientId,
        broker: mqtt_client.options.hostname
    });
});

mqtt_client.on('error', (error) => {
    logDetail('MQTT_ERROR', 'Connection error', {
        message: error.message,
        errorCode: error.code
    });
});

mqtt_client.on('close', () => {
    logDetail('MQTT', 'Connection closed');
});

// Setup koneksi awal
function setupConnection() {
    myId = document.getElementById('myId').value;
    if (!myId) {
        logDetail('ERROR', 'No ID provided');
        return alert('Masukkan ID Anda');
    }

    logDetail('SETUP', 'Initializing connection', {
        userId: myId,
        timestamp: Date.now()
    });
    
    mqtt_client.subscribe(`vchat/${myId}`, (err) => {
        if (err) {
            logDetail('MQTT_ERROR', 'Subscription failed', {
                topic: `vchat/${myId}`,
                error: err
            });
        } else {
            logDetail('MQTT', 'Subscription successful', {
                topic: `vchat/${myId}`
            });
        }
    });
    
    document.getElementById('setup').classList.add('hidden');
    document.getElementById('caller').classList.remove('hidden');
    document.getElementById('myIdDisplay').textContent = myId;
}

// Tambahkan fungsi untuk menangani signaling
async function handleSignaling(destinationId) {
    try {
        // Buat peer connection terlebih dahulu
        createPeerConnection();
        
        if (currentCall.isInitiator) {
            // Buat dan kirim offer
            const offer = await peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            
            await peerConnection.setLocalDescription(offer);
            
            // Kirim offer ke peer tujuan
            mqtt_client.publish(`vchat/${destinationId}`, JSON.stringify({
                type: 'offer',
                sdp: offer,
                from: myId
            }));
            
            logDetail('WEBRTC', 'Offer sent', { destinationId });
        }
    } catch (err) {
        logDetail('ERROR', 'Signaling failed', { error: err });
    }
}

// Update fungsi initiateCall
async function initiateCall() {
    const destinationId = document.getElementById('destinationId').value;
    if (!destinationId) {
        return alert('Masukkan ID Tujuan');
    }

    try {
        // Dapatkan media stream
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true
            }
        });

        // Tampilkan video lokal
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        await localVideo.play();

        // Set current call details
        currentCall.destinationId = destinationId;
        currentCall.isInitiator = true;

        // Kirim permintaan panggilan
        mqtt_client.publish(`vchat/${destinationId}`, JSON.stringify({
            type: 'call_request',
            from: myId,
            timestamp: Date.now()
        }));

        document.getElementById('caller').classList.add('hidden');
        document.getElementById('videos').classList.remove('hidden');

    } catch (err) {
        logDetail('ERROR', 'Media access failed', { error: err });
        handleMediaError(err);
    }
}

// Terima panggilan
async function acceptCall() {
    logDetail('CALL', 'Accepting call', {
        from: currentCall.destinationId
    });
    
    document.getElementById('callNotification').classList.add('hidden');
    document.getElementById('setup').classList.add('hidden');
    document.getElementById('caller').classList.add('hidden');
    document.getElementById('videos').classList.remove('hidden');

    try {
        // Dapatkan media stream
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true
            }
        });

        // Tampilkan video lokal
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        localVideo.play().catch(e => logDetail('ERROR', 'Local video play failed', e));

        // Buat peer connection
        createPeerConnection();

        // Kirim acceptance
        mqtt_client.publish(`vchat/${currentCall.destinationId}`, JSON.stringify({
            type: 'call_accepted',
            from: myId
        }));

    } catch (err) {
        logDetail('ERROR', 'Media access failed', { error: err });
        handleMediaError(err);
    }
}

function createPeerConnection() {
    logDetail('WEBRTC', 'Creating peer connection');
    
    const configuration = {
        iceServers: [
            {
                urls: [
                    'stun:stun.l.google.com:19302',
                    'stun:stun1.l.google.com:19302'
                ]
            },
            {
                urls: [
                    'turn:openrelay.metered.ca:80',
                    'turn:openrelay.metered.ca:443'
                ],
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ],
        iceTransportPolicy: 'all',
        iceCandidatePoolSize: 10
    };
    
    peerConnection = new RTCPeerConnection(configuration);

    // Handle ICE candidates
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            mqtt_client.publish(`vchat/${currentCall.destinationId}`, JSON.stringify({
                type: 'candidate',
                candidate: event.candidate,
                from: myId
            }));
        }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
        logDetail('WEBRTC', 'Connection state changed', {
            state: peerConnection.connectionState
        });
        
        if (peerConnection.connectionState === 'failed') {
            restartConnection();
        }
    };

    return peerConnection;
}

// Tambahkan fungsi untuk restart koneksi
async function restartConnection() {
    logDetail('WEBRTC', 'Restarting connection');
    
    try {
        if (peerConnection) {
            peerConnection.close();
        }
        
        // Buat koneksi baru
        createPeerConnection();
        
        // Tambahkan track ulang
        if (localStream) {
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
        }
        
        // Kirim ulang offer jika initiator
        if (currentCall.isInitiator) {
            const offer = await peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
                iceRestart: true
            });
            
            await peerConnection.setLocalDescription(offer);
            
            mqtt_client.publish(`vchat/${currentCall.destinationId}`, JSON.stringify({
                type: 'offer',
                sdp: offer,
                from: myId,
                isRestart: true
            }));
        }
    } catch (err) {
        logDetail('ERROR', 'Connection restart failed', { error: err });
    }
}

// MQTT message handler
mqtt_client.on('message', async (topic, message) => {
    try {
        const msg = JSON.parse(message.toString());
        logDetail('MQTT', 'Received message', { type: msg.type, from: msg.from });

        switch(msg.type) {
            case 'candidate':
                if (peerConnection && msg.candidate) {
                    try {
                        await peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
                        logDetail('ICE', 'Added ICE candidate');
                    } catch (err) {
                        logDetail('ERROR', 'Failed to add ICE candidate', { error: err });
                    }
                }
                break;

            case 'offer':
                try {
                    if (!peerConnection) {
                        createPeerConnection();
                    }
                    
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                    
                    const answer = await peerConnection.createAnswer();
                    await peerConnection.setLocalDescription(answer);
                    
                    mqtt_client.publish(`vchat/${msg.from}`, JSON.stringify({
                        type: 'answer',
                        sdp: answer,
                        from: myId
                    }));
                    
                    logDetail('WEBRTC', 'Answer sent');
                } catch (err) {
                    logDetail('ERROR', 'Failed to handle offer', { error: err });
                }
                break;

            case 'answer':
                if (peerConnection) {
                    try {
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                        logDetail('WEBRTC', 'Remote description set');
                    } catch (err) {
                        logDetail('ERROR', 'Failed to set remote description', { error: err });
                    }
                }
                break;
        }
    } catch (err) {
        logDetail('ERROR', 'Failed to process message', { error: err });
    }
});

// Fungsi untuk toggle mute audio
function toggleMute() {
    logDetail('MEDIA', `Toggling audio: ${isAudioMuted ? 'unmute' : 'mute'}`);
    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            track.enabled = isAudioMuted;
        });
        isAudioMuted = !isAudioMuted;
        document.getElementById('muteIcon').textContent = isAudioMuted ? '🔇' : '🎤';
    }
}

// Fungsi untuk toggle video
function toggleVideo() {
    logDetail('MEDIA', `Toggling video: ${isVideoMuted ? 'show' : 'hide'}`);
    if (localStream) {
        localStream.getVideoTracks().forEach(track => {
            track.enabled = isVideoMuted;
        });
        isVideoMuted = !isVideoMuted;
        document.getElementById('videoIcon').textContent = isVideoMuted ? '🚫' : '📹';
        
        // Update kedua video element untuk self-call
        if (currentCall.destinationId === myId) {
            const remoteVideo = document.getElementById('remoteVideo');
            remoteVideo.style.display = isVideoMuted ? 'none' : 'block';
        }
    }
}

// Update fungsi endCall
function endCall() {
    logDetail('CALL', 'Ending call');
    
    if (currentCall.destinationId && currentCall.destinationId !== myId) {
        mqtt_client.publish(`vchat/${currentCall.destinationId}`, JSON.stringify({
            type: 'call_ended',
            from: myId
        }));
    }
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            logDetail('MEDIA', 'Stopping track', {
                kind: track.kind
            });
            track.stop();
        });
    }
    
    if (peerConnection) {
        logDetail('WEBRTC', 'Closing peer connection');
        peerConnection.close();
    }
    
    // Reset video elements
    document.getElementById('localVideo').srcObject = null;
    document.getElementById('remoteVideo').srcObject = null;
    
    resetCall();
    document.getElementById('videos').classList.add('hidden');
    document.getElementById('caller').classList.remove('hidden');
}

function resetCall() {
    logDetail('CALL', 'Resetting call state');
    currentCall = {
        destinationId: null,
        isInitiator: false
    };
}

function handleMediaError(error) {
    logDetail('ERROR', 'Media error occurred', { error });
    
    let errorMessage = 'Terjadi kesalahan media: ';
    
    switch (error.name) {
        case 'NotFoundError':
            errorMessage += 'Kamera atau mikrofon tidak ditemukan';
            break;
        case 'NotAllowedError':
            errorMessage += 'Akses ke kamera/mikrofon ditolak';
            break;
        case 'NotReadableError':
            errorMessage += 'Perangkat media sedang digunakan';
            break;
        default:
            errorMessage += error.message;
    }
    
    alert(errorMessage);
    endCall();
}

function handleError(error, context) {
    logDetail('ERROR', `Error in ${context}`, { error });
    
    let message = 'Terjadi kesalahan: ';
    switch(context) {
        case 'media':
            message += 'Tidak dapat mengakses kamera/mikrofon';
            break;
        case 'connection':
            message += 'Koneksi terputus';
            break;
        case 'signaling':
            message += 'Gagal menghubungkan dengan peer';
            break;
        default:
            message += error.message;
    }
    
    alert(message);
    endCall();
}
