let peerConnection;
let localStream;
const mqtt_client = mqtt.connect('wss://broker.emqx.io:8084/mqtt');
let myId = null;
let currentCall = {
    destinationId: null,
    isInitiator: false
};

// Setup koneksi awal
function setupConnection() {
    myId = document.getElementById('myId').value;
    if (!myId) return alert('Masukkan ID Anda');

    // Subscribe ke topic pribadi
    mqtt_client.subscribe(`vchat/${myId}`);
    
    document.getElementById('setup').classList.add('hidden');
    document.getElementById('caller').classList.remove('hidden');
    document.getElementById('myIdDisplay').textContent = myId;
}

// Inisiasi panggilan
async function initiateCall() {
    const destinationId = document.getElementById('destinationId').value;
    if (!destinationId) return alert('Masukkan ID Tujuan');

    currentCall.destinationId = destinationId;
    currentCall.isInitiator = true;

    // Kirim permintaan panggilan
    mqtt_client.publish(`vchat/${destinationId}`, JSON.stringify({
        type: 'call_request',
        from: myId
    }));
}

// Terima panggilan
async function acceptCall() {
    document.getElementById('callNotification').classList.add('hidden');
    document.getElementById('videos').classList.remove('hidden');

    try {
        // Dapatkan akses media
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        document.getElementById('localVideo').srcObject = localStream;

        // Setup WebRTC
        createPeerConnection();

        // Jika bukan initiator, kirim answer
        if (!currentCall.isInitiator) {
            mqtt_client.publish(`vchat/${currentCall.destinationId}`, JSON.stringify({
                type: 'call_accepted',
                from: myId
            }));
        }
    } catch (err) {
        console.error('Error:', err);
        alert('Gagal mengakses kamera/mikrofon');
    }
}

// Tolak panggilan
function rejectCall() {
    document.getElementById('callNotification').classList.add('hidden');
    mqtt_client.publish(`vchat/${currentCall.destinationId}`, JSON.stringify({
        type: 'call_rejected',
        from: myId
    }));
    resetCall();
}

function createPeerConnection() {
    peerConnection = new RTCPeerConnection({ iceServers });

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = event => {
        document.getElementById('remoteVideo').srcObject = event.streams[0];
    };

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            mqtt_client.publish(`vchat/${currentCall.destinationId}`, JSON.stringify({
                type: 'candidate',
                candidate: event.candidate
            }));
        }
    };
}

// MQTT message handler
mqtt_client.on('message', async (topic, message) => {
    const msg = JSON.parse(message.toString());

    switch(msg.type) {
        case 'call_request':
            currentCall.destinationId = msg.from;
            document.getElementById('callerId').textContent = msg.from;
            document.getElementById('callNotification').classList.remove('hidden');
            break;

        case 'call_accepted':
            if (currentCall.isInitiator) {
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
                    
                    mqtt_client.publish(`vchat/${currentCall.destinationId}`, JSON.stringify({
                        type: 'offer',
                        sdp: offer,
                        from: myId
                    }));
                } catch (err) {
                    console.error('Error:', err);
                }
            }
            break;

        case 'call_rejected':
            alert('Panggilan ditolak');
            resetCall();
            break;

        case 'offer':
            await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            mqtt_client.publish(`vchat/${msg.from}`, JSON.stringify({
                type: 'answer',
                sdp: answer,
                from: myId
            }));
            break;

        case 'answer':
            await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            break;

        case 'candidate':
            if (peerConnection) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
            }
            break;
    }
});

// Tambahkan fungsi untuk mengakhiri panggilan
function endCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (peerConnection) {
        peerConnection.close();
    }
    resetCall();
    document.getElementById('videos').classList.add('hidden');
    document.getElementById('caller').classList.remove('hidden');
}

function resetCall() {
    currentCall = {
        destinationId: null,
        isInitiator: false
    };
}
