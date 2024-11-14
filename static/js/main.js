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

// Inisiasi panggilan
async function initiateCall() {
    const destinationId = document.getElementById('destinationId').value;
    if (!destinationId) {
        logDetail('ERROR', 'No destination ID provided');
        return alert('Masukkan ID Tujuan');
    }

    // Tambahkan pengecekan self-calling
    if (destinationId === myId) {
        logDetail('CALL', 'Self-calling detected', { myId });
        try {
            // Minta akses media terlebih dahulu
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

            // Tampilkan video lokal di kedua element
            const localVideo = document.getElementById('localVideo');
            const remoteVideo = document.getElementById('remoteVideo');
            
            localVideo.srcObject = localStream;
            remoteVideo.srcObject = localStream;

            // Tampilkan container video
            document.getElementById('caller').classList.add('hidden');
            document.getElementById('videos').classList.remove('hidden');

            logDetail('MEDIA', 'Self-call media setup complete', {
                tracks: localStream.getTracks().map(t => ({
                    kind: t.kind,
                    enabled: t.enabled
                }))
            });

        } catch (err) {
            logDetail('ERROR', 'Self-call media access failed', { error: err });
            handleMediaError(err);
        }
        return;
    }

    // Lanjutkan dengan normal call flow untuk non-self calls
    logDetail('CALL', 'Initiating call', {
        destinationId: destinationId,
        isInitiator: true
    });
    currentCall.destinationId = destinationId;
    currentCall.isInitiator = true;

    mqtt_client.publish(`vchat/${destinationId}`, JSON.stringify({
        type: 'call_request',
        from: myId
    }));
}

// Terima panggilan
async function acceptCall() {
    logDetail('CALL', 'Accepting call', {
        from: currentCall.destinationId
    });
    
    document.getElementById('callNotification').classList.add('hidden');
    document.getElementById('videos').classList.remove('hidden');

    try {
        // Request media dengan constraints yang lebih spesifik
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

        logDetail('MEDIA', 'Local media stream created', {
            tracks: localStream.getTracks().map(t => t.kind)
        });

        // Set local video
        const localVideo = document.getElementById('localVideo');
        localVideo.srcObject = localStream;
        localVideo.play().catch(err => logDetail('ERROR', 'Local video play failed', { error: err }));

        // Create and setup peer connection
        createPeerConnection();

        // Send acceptance signal
        if (!currentCall.isInitiator) {
            mqtt_client.publish(`vchat/${currentCall.destinationId}`, JSON.stringify({
                type: 'call_accepted',
                from: myId
            }));
            logDetail('SIGNALING', 'Call acceptance sent');
        }
    } catch (err) {
        logDetail('ERROR', 'Media access failed', { error: err });
        alert('Gagal mengakses kamera/mikrofon: ' + err.message);
        endCall();
    }
}

function createPeerConnection() {
    logDetail('WEBRTC', 'Creating peer connection', {
        iceServers: iceServers
    });
    peerConnection = new RTCPeerConnection({ iceServers });

    // Handle ICE candidates
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            logDetail('ICE', 'New ICE candidate', {
                candidate: event.candidate
            });
            mqtt_client.publish(`vchat/${currentCall.destinationId}`, JSON.stringify({
                type: 'candidate',
                candidate: event.candidate,
                from: myId
            }));
        }
    };

    // Improved track handling
    peerConnection.ontrack = event => {
        logDetail('MEDIA', 'Received remote track', {
            kind: event.track.kind,
            id: event.track.id
        });
        
        const remoteStream = event.streams[0];
        const remoteVideo = document.getElementById('remoteVideo');
        
        if (remoteVideo.srcObject !== remoteStream) {
            remoteVideo.srcObject = remoteStream;
            logDetail('MEDIA', 'Remote video stream connected');
        }
    };

    // Add local tracks to peer connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            logDetail('MEDIA', 'Adding local track', {
                kind: track.kind,
                id: track.id
            });
            peerConnection.addTrack(track, localStream);
        });
    }

    // Connection state monitoring
    peerConnection.onconnectionstatechange = () => {
        logDetail('WEBRTC', 'Connection state changed', {
            state: peerConnection.connectionState
        });
        
        if (peerConnection.connectionState === 'failed') {
            logDetail('ERROR', 'Connection failed - attempting reconnect');
            restartIce();
        }
    };

    return peerConnection;
}

// Fungsi untuk restart ICE jika koneksi gagal
async function restartIce() {
    if (peerConnection && currentCall.isInitiator) {
        try {
            const offer = await peerConnection.createOffer({ iceRestart: true });
            await peerConnection.setLocalDescription(offer);
            
            mqtt_client.publish(`vchat/${currentCall.destinationId}`, JSON.stringify({
                type: 'offer',
                sdp: offer,
                from: myId
            }));
            
            logDetail('WEBRTC', 'ICE restart initiated');
        } catch (err) {
            logDetail('ERROR', 'ICE restart failed', { error: err });
        }
    }
}

// MQTT message handler
mqtt_client.on('message', async (topic, message) => {
    const msg = JSON.parse(message.toString());
    logDetail('MQTT', 'Received message', {
        type: msg.type,
        from: msg.from || 'unknown',
        topic: topic,
        timestamp: Date.now()
    });

    switch(msg.type) {
        case 'call_request':
            logDetail('CALL', 'Incoming call', {
                destinationId: msg.from
            });
            currentCall.destinationId = msg.from;
            document.getElementById('callerId').textContent = msg.from;
            document.getElementById('callNotification').classList.remove('hidden');
            break;

        case 'call_accepted':
            if (currentCall.isInitiator) {
                logDetail('CALL', 'Call accepted', {
                    destinationId: currentCall.destinationId
                });
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
                    logDetail('WEBRTC', 'Local description set', {
                        sdp: offer
                    });
                    
                    mqtt_client.publish(`vchat/${currentCall.destinationId}`, JSON.stringify({
                        type: 'offer',
                        sdp: offer,
                        from: myId
                    }));
                } catch (err) {
                    logDetail('ERROR', 'Error in call acceptance', {
                        error: err
                    });
                }
            }
            break;

        case 'offer':
            logDetail('WEBRTC', 'Received offer', {
                sdp: msg.sdp
            });
            await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            mqtt_client.publish(`vchat/${msg.from}`, JSON.stringify({
                type: 'answer',
                sdp: answer,
                from: myId
            }));
            logDetail('WEBRTC', 'Answer sent');
            break;

        case 'answer':
            logDetail('WEBRTC', 'Received answer');
            await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            break;

        case 'candidate':
            if (peerConnection) {
                logDetail('ICE', 'Adding ICE candidate');
                await peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
            }
            break;

        case 'call_rejected':
            logDetail('CALL', 'Call rejected');
            alert('Panggilan ditolak');
            resetCall();
            break;

        case 'call_ended':
            logDetail('CALL', 'Call ended', {
                from: msg.from
            });
            endCall();
            break;
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
