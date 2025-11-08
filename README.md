# WebRTC Mesh Architecture - Essential Guide

**Live App:** https://network.randoman.online

---

## Architecture Overview

```
User Authentication → MongoDB (JWT)
Call Signaling → Firebase Firestore
Media Streams → Direct P2P WebRTC (LAN)
```

![WhatsApp Image 2025-11-08 at 14 15 42_df99bfeb](https://github.com/user-attachments/assets/841b2f0f-3dbf-4a31-add4-e59b3d276ff3)

---

## Core Components

### 1. Client (React App)
- Access camera/microphone via `getUserMedia()`
- Manage `RTCPeerConnection` for each peer
- Send/receive signaling via Firebase
- Display local/remote video streams

### 2. MongoDB + JWT
- Stores: User credentials, profiles, preferences
- JWT authentication for API access
- No media data

### 3. Firebase Firestore
- Stores: Call sessions, SDP offers/answers, ICE candidates
- Real-time signaling coordination
- No media data

### 4. WebRTC P2P (LAN)
- Direct encrypted media streams
- SRTP/DTLS encryption (automatic)
- No server in media path

---

## Mesh Network

**Definition:** Every participant connects directly to every other participant.

```
3 Users = 3 connections:
A ↔ B
A ↔ C  
B ↔ C

N users = N×(N-1)/2 connections
```

**Bandwidth per user (N participants):**
- Upload: `(N-1) × 1.5 Mbps` @ 720p
- Download: `(N-1) × 1.5 Mbps`

**Limits:**
- ✅ 2-4 users: Excellent
- ⚠️ 5-6 users: Good
- ❌ 7+ users: Use SFU instead

---

## Call Flow

### 1. Authentication
```javascript
POST /api/auth/login → MongoDB validates → Returns JWT
// Store JWT, use in Authorization header
```

### 2. Create Call
```javascript
// Create in Firebase
firestore.collection('calls').doc(callId).set({
  createdBy: userId,
  participants: [userId],
  status: 'active'
});
```

### 3. WebRTC Signaling

**Offer:**
```javascript
const pc = new RTCPeerConnection({ iceServers: [...] });
localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

const offer = await pc.createOffer();
await pc.setLocalDescription(offer);

// Send to Firebase
firestore.collection('calls').doc(callId)
  .collection('offers').doc(remoteUserId).set(offer);
```

**Answer:**
```javascript
await pc.setRemoteDescription(offer);
const answer = await pc.createAnswer();
await pc.setLocalDescription(answer);

// Send to Firebase
firestore.collection('calls').doc(callId)
  .collection('answers').doc(remoteUserId).set(answer);
```

**ICE Candidates:**
```javascript
pc.onicecandidate = (e) => {
  if (e.candidate) {
    firestore.collection('calls').doc(callId)
      .collection('candidates').add({
        candidate: e.candidate.toJSON(),
        from: userId,
        to: remoteUserId
      });
  }
};
```

### 4. Direct Media
```javascript
pc.ontrack = (event) => {
  videoElement.srcObject = event.streams[0];
};
```

---

## Security

### Encryption
- **SRTP:** Encrypts media packets (AES-128/256)
- **DTLS:** Secure key exchange (TLS 1.2+)
- Automatic, no manual configuration needed

### Data Separation
| Service | Stores |
|---------|--------|
| MongoDB | User credentials, profiles |
| Firebase | Call metadata, signaling messages |
| WebRTC | Nothing (direct P2P) |

**Media never touches MongoDB or Firebase**

### LAN Confidentiality
- Media flows: Device A ↔ LAN ↔ Device B
- Never routes through internet (if all users on LAN)
- Firebase only sees: "User A joined at 10:30"
- Firebase does NOT see: Audio/video content

---

## NAT Traversal

**Connection Priority:**
1. **Direct (LAN)** - Best, 10-50ms latency
2. **STUN** - Good, discovers public IP
3. **TURN** - Fallback, relays traffic

```javascript
const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { 
    urls: 'turn:your-server:3478',
    username: 'user',
    credential: 'pass'
  }
];
```

---

## Performance

### Video Quality
| Quality | Resolution | Bitrate | 4 Users Bandwidth |
|---------|-----------|---------|-------------------|
| Low | 320×240 | 250 Kbps | 1.5 Mbps |
| Medium | 640×480 | 500 Kbps | 3 Mbps |
| HD | 1280×720 | 1.5 Mbps | 9 Mbps |
| Full HD | 1920×1080 | 3 Mbps | 18 Mbps |

### Hardware
| Users | CPU | RAM |
|-------|-----|-----|
| 2-3 | Dual-core 2GHz | 4GB |
| 4-5 | Quad-core 2.5GHz | 8GB |
| 6-8 | Hexa-core 3GHz | 16GB |

---

## Complete Example

```javascript
class VideoCall {
  constructor(userId, callId) {
    this.userId = userId;
    this.callId = callId;
    this.peerConnections = {};
    this.firestore = firebase.firestore();
  }

  async start() {
    // Get local media
    this.localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720 },
      audio: true
    });
    
    document.getElementById('local-video').srcObject = this.localStream;

    // Listen for signaling
    this.listenForOffers();
    this.listenForAnswers();
    this.listenForCandidates();
  }

  createPeerConnection(remoteUserId) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    this.localStream.getTracks().forEach(t => pc.addTrack(t, this.localStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendCandidate(remoteUserId, e.candidate);
    };

    pc.ontrack = (e) => {
      document.getElementById(`remote-${remoteUserId}`).srcObject = e.streams[0];
    };

    this.peerConnections[remoteUserId] = pc;
    return pc;
  }

  async sendOffer(remoteUserId) {
    const pc = this.createPeerConnection(remoteUserId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await this.firestore.collection('calls').doc(this.callId)
      .collection('offers').doc(remoteUserId).set(offer);
  }

  listenForOffers() {
    this.firestore.collection('calls').doc(this.callId)
      .collection('offers').doc(this.userId)
      .onSnapshot(async (snap) => {
        if (!snap.exists) return;
        const offer = snap.data();
        
        const pc = this.createPeerConnection(offer.from);
        await pc.setRemoteDescription(offer);
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        await this.firestore.collection('calls').doc(this.callId)
          .collection('answers').doc(offer.from).set(answer);
      });
  }

  listenForAnswers() {
    this.firestore.collection('calls').doc(this.callId)
      .collection('answers').doc(this.userId)
      .onSnapshot(async (snap) => {
        if (!snap.exists) return;
        const answer = snap.data();
        const pc = this.peerConnections[answer.from];
        if (pc) await pc.setRemoteDescription(answer);
      });
  }

  listenForCandidates() {
    this.firestore.collection('calls').doc(this.callId)
      .collection('candidates').where('to', '==', this.userId)
      .onSnapshot(snap => {
        snap.docChanges().forEach(async change => {
          if (change.type === 'added') {
            const data = change.doc.data();
            const pc = this.peerConnections[data.from];
            if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        });
      });
  }

  sendCandidate(remoteUserId, candidate) {
    this.firestore.collection('calls').doc(this.callId)
      .collection('candidates').add({
        candidate: candidate.toJSON(),
        from: this.userId,
        to: remoteUserId
      });
  }

  end() {
    this.localStream.getTracks().forEach(t => t.stop());
    Object.values(this.peerConnections).forEach(pc => pc.close());
  }
}

// Usage
const call = new VideoCall('user123', 'call456');
await call.start();
await call.sendOffer('user789');
```

---

## Troubleshooting

### Connection Failed
```javascript
// Check ICE state
pc.oniceconnectionstatechange = () => {
  console.log('ICE:', pc.iceConnectionState);
  if (pc.iceConnectionState === 'failed') {
    // Add TURN server or check firewall
  }
};
```

### Poor Quality
```javascript
// Monitor stats
setInterval(async () => {
  const stats = await pc.getStats();
  stats.forEach(report => {
    if (report.type === 'inbound-rtp' && report.kind === 'video') {
      const loss = report.packetsLost / report.packetsReceived * 100;
      console.log('Packet loss:', loss + '%');
    }
  });
}, 3000);

// Reduce quality if needed
const sender = pc.getSenders().find(s => s.track.kind === 'video');
const params = sender.getParameters();
params.encodings[0].maxBitrate = 500000; // 500 Kbps
await sender.setParameters(params);
```

### Audio Echo
```javascript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
});

// Mute local audio element
localAudioElement.muted = true;
```

---

## Deployment

### Current Setup
```yaml
Frontend: https://network.randoman.online
Backend: JWT + MongoDB
Signaling: Firebase Firestore
STUN/TURN: Public servers
Media: Direct P2P (encrypted)
```

### LAN-Only Alternative
```yaml
Backend: JWT + MongoDB (same)
Signaling: Socket.io on local server
STUN/TURN: coturn on local server
Network: Isolated VLAN
Result: 100% on-premise, zero cloud
```

**coturn setup:**
```bash
# Install
sudo apt-get install coturn

# Configure /etc/turnserver.conf
listening-ip=192.168.1.100
external-ip=your-public-ip
realm=yourdomain.local
user=username:password
```

---

## When to Switch to SFU

**Use SFU (not mesh) when:**
- 7+ regular participants
- Users have limited upload bandwidth
- Need recording/streaming
- Want better quality control

**SFU topology:**
```
Mesh:              SFU:
A ↔ B              A → SFU → B
A ↔ C              B → SFU → A,C
B ↔ C              C → SFU → A,B

Upload:            Upload:
A sends to B,C     A sends once to SFU
```

---

## Key Takeaways

✅ **Authentication:** JWT + MongoDB  
✅ **Signaling:** Firebase (temporary, metadata only)  
✅ **Media:** Direct P2P (never touches servers)  
✅ **Encryption:** Automatic SRTP/DTLS  
✅ **Optimal for:** 2-6 users on LAN  
✅ **Confidential:** Media stays in LAN  

**What Firebase sees:** Call metadata, user presence  
**What Firebase does NOT see:** Audio, video, conversation

**What flows through LAN:** All media (encrypted)  
**What flows through internet:** Only signaling (if Firebase used)
