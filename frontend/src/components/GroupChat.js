import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { db, storage } from '../firebaseConfig';
import { 
    collection, query, orderBy, onSnapshot, addDoc, 
    serverTimestamp, doc, setDoc, deleteDoc, getDoc, updateDoc, arrayUnion
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import { v4 as uuidv4 } from 'uuid';
import CryptoJS from 'crypto-js';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const SECRET_KEY = "your_secure_secret_key_here"; 

const GroupChat = () => {
    const { user } = useAuth();
    // chatId is the Call ID used to create the group
    const { chatId } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    
    // --- SAFE NAME LOGIC ---
    // Create a robust name string to prevent "undefined undefined"
    const currentUserName = user ? (
        user.name || 
        user.displayName || 
        (user.firstname && user.lastname ? `${user.firstname} ${user.lastname}` : null) || 
        user.email || 
        "Unknown User"
    ) : "Unknown User";

    // State
    const [groupName, setGroupName] = useState(location.state?.recipientName || 'Group Chat');
    const [totalParticipants, setTotalParticipants] = useState(0); 
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [typingUsers, setTypingUsers] = useState([]);
    
    // Upload & Recording State
    const [isUploading, setIsUploading] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [mediaRecorder, setMediaRecorder] = useState(null);
    const [audioChunks, setAudioChunks] = useState([]);

    // Modals State
    const [deleteTargetId, setDeleteTargetId] = useState(null);
    const [infoTargetMessage, setInfoTargetMessage] = useState(null); 
    const [readByUsersData, setReadByUsersData] = useState([]); 
    const [isLoadingInfo, setIsLoadingInfo] = useState(false);

    // Refs
    const messagesEndRef = useRef(null);
    const typingTimeoutRef = useRef(null);
    const fileInputRef = useRef(null);

    const handleClose = () => navigate(-1);

    // --- Encryption Helpers ---
    const encryptMessage = (text) => CryptoJS.AES.encrypt(text, SECRET_KEY).toString();
    const decryptMessage = (cipherText) => {
        try {
            const bytes = CryptoJS.AES.decrypt(cipherText, SECRET_KEY);
            const decrypted = bytes.toString(CryptoJS.enc.Utf8);
            return decrypted || cipherText;
        } catch (error) {
            return cipherText;
        }
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, typingUsers, isRecording]);

    // --- 1. Fetch Group Details & Messages & Read Receipts ---
    useEffect(() => {
        if (!chatId || !user) return;

        // Fetch Group Name & Participant Count
        const fetchGroupDetails = async () => {
            const docRef = doc(db, 'group_chats', chatId);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                setGroupName(data.groupName);
                const participants = data.participants || []; 
                setTotalParticipants(participants.length);
            }
        };
        fetchGroupDetails();

        // Listen for Messages
        const messagesRef = collection(db, 'group_chats', chatId, 'messages');
        const q = query(messagesRef, orderBy('timestamp', 'asc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const msgs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setMessages(msgs);

            // --- Read Receipt Logic (Blue Ticks) ---
            snapshot.docs.forEach(async (docSnap) => {
                const data = docSnap.data();
                const readBy = data.readBy || [];
                
                // Check if I exist in the array (Handle both old string IDs and new Objects)
                const hasRead = readBy.some(item => 
                    (typeof item === 'string' && item === user._id) || 
                    (typeof item === 'object' && item.uid === user._id)
                );

                // If I haven't marked as read yet and I am NOT the sender
                if (data.senderId !== user._id && !hasRead) {
                    try {
                        // FIX: Use currentUserName to avoid "undefined undefined"
                        await updateDoc(docSnap.ref, {
                            readBy: arrayUnion({
                                uid: user._id,
                                name: currentUserName 
                            })
                        });
                    } catch (err) {
                        console.error("Error updating group read receipt:", err);
                    }
                }
            });
        });

        return () => unsubscribe();
    }, [chatId, user, currentUserName]);

    // --- 2. Typing Logic ---
    useEffect(() => {
        if (!chatId || !user) return;

        const chatDocRef = doc(db, 'group_chats', chatId);
        const unsubChat = onSnapshot(chatDocRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();
                const typingData = data.typing || {};
                
                const typingList = Object.keys(typingData)
                    .filter(userId => userId !== user._id && typingData[userId]?.isTyping)
                    .map(userId => typingData[userId].name);
                
                setTypingUsers(typingList);
            }
        });

        return () => unsubChat();
    }, [chatId, user]);

    const handleTyping = async (e) => {
        setNewMessage(e.target.value);
        if (!user || !chatId) return;

        if (!isTyping) {
            setIsTyping(true);
            const chatDocRef = doc(db, 'group_chats', chatId);
            await setDoc(chatDocRef, { 
                typing: { 
                    [user._id]: { isTyping: true, name: currentUserName } 
                } 
            }, { merge: true });
        }

        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        
        typingTimeoutRef.current = setTimeout(async () => {
            setIsTyping(false);
            const chatDocRef = doc(db, 'group_chats', chatId);
            await setDoc(chatDocRef, { 
                typing: { 
                    [user._id]: { isTyping: false, name: currentUserName } 
                } 
            }, { merge: true });
        }, 2000);
    };

    // --- 3. Send Message ---
    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim()) return;

        try {
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            await setDoc(doc(db, 'group_chats', chatId), { 
                typing: { [user._id]: { isTyping: false } } 
            }, { merge: true });
            setIsTyping(false);

            const encryptedText = encryptMessage(newMessage);

            await addDoc(collection(db, 'group_chats', chatId, 'messages'), {
                text: encryptedText, 
                type: 'text',
                senderName: currentUserName, // FIX: Use safe name
                senderId: user._id,
                senderEmail: user.email,
                timestamp: serverTimestamp(),
                readBy: [{ 
                    uid: user._id, 
                    name: currentUserName // FIX: Use safe name
                }]
            });
            setNewMessage('');
        } catch (error) {
            console.error("Error sending message:", error);
            toast.error("Failed to send message.");
        }
    };

    // --- 4. File/Audio Logic ---
    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > MAX_FILE_SIZE) {
            toast.error("File is too large. Max size is 10MB.");
            return;
        }

        setIsUploading(true);
        try {
            const isImage = file.type.startsWith('image/');
            const msgType = isImage ? 'image' : 'file';
            const fileId = uuidv4();
            const filePath = `groupChatFiles/${chatId}/${fileId}-${file.name}`;
            const storageRef = ref(storage, filePath);

            const snapshot = await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(snapshot.ref);

            await addDoc(collection(db, 'group_chats', chatId, 'messages'), {
                type: msgType,
                fileUrl: downloadURL,
                fileName: file.name,
                fileSize: file.size,
                senderName: currentUserName, // FIX: Use safe name
                senderId: user._id,
                senderEmail: user.email,
                timestamp: serverTimestamp(),
                readBy: [{ 
                    uid: user._id, 
                    name: currentUserName // FIX: Use safe name
                }]
            });

        } catch (error) {
            console.error("Upload failed:", error);
            toast.error("Failed to upload file.");
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            setMediaRecorder(recorder);
            setAudioChunks([]);

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) setAudioChunks((prev) => [...prev, event.data]);
            };

            recorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' }); 
                await uploadAudio(audioBlob);
                stream.getTracks().forEach(track => track.stop());
            };

            recorder.start();
            setIsRecording(true);
        } catch (err) {
            toast.error("Microphone access denied.");
        }
    };

    const stopRecording = () => {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            setIsRecording(false);
        }
    };

    const uploadAudio = async (blob) => {
        setIsUploading(true);
        try {
            const fileId = uuidv4();
            const filePath = `groupChatVoice/${chatId}/${fileId}.webm`;
            const storageRef = ref(storage, filePath);
            
            const snapshot = await uploadBytes(storageRef, blob);
            const downloadURL = await getDownloadURL(snapshot.ref);

            await addDoc(collection(db, 'group_chats', chatId, 'messages'), {
                type: 'audio',
                fileUrl: downloadURL,
                fileName: 'Voice Message',
                senderName: currentUserName, // FIX: Use safe name
                senderId: user._id,
                senderEmail: user.email,
                timestamp: serverTimestamp(),
                readBy: [{ 
                    uid: user._id, 
                    name: currentUserName // FIX: Use safe name
                }]
            });

        } catch (error) {
            toast.error("Failed to send voice message.");
        } finally {
            setIsUploading(false);
        }
    };

    const promptDelete = (messageId) => setDeleteTargetId(messageId);

    const confirmDeleteMessage = async () => {
        if (!deleteTargetId) return;
        try {
            await deleteDoc(doc(db, 'group_chats', chatId, 'messages', deleteTargetId));
            toast.success("Message deleted");
        } catch (error) {
            toast.error("Could not delete message");
        } finally {
            setDeleteTargetId(null);
        }
    };

    // --- Message Info Logic ---
    const handleShowInfo = (msg) => {
        setInfoTargetMessage(msg);
        
        const readers = (msg.readBy || [])
            .filter(item => {
                // Filter out the sender
                const itemId = typeof item === 'string' ? item : item.uid;
                return itemId !== msg.senderId;
            })
            .map(item => {
                // If it's the new format (Object with name), use it!
                if (typeof item === 'object' && item.name) {
                    return { id: item.uid, name: item.name };
                }
                // Fallback for old messages
                return { id: item, name: "Unknown (Old Message)" };
            });

        setReadByUsersData(readers);
        setIsLoadingInfo(false);
    };

    const closeInfoModal = () => {
        setInfoTargetMessage(null);
        setReadByUsersData([]);
    };

    // --- Helpers ---
    const formatTime = (timestamp) => {
        if (!timestamp) return '...';
        return timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    };

    const formatBytes = (bytes, decimals = 2) => {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
    };

    const getDateLabel = (timestamp) => {
        if (!timestamp) return null;
        const date = timestamp.toDate();
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) return 'Today';
        else if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
        else return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    };

    if (!user) return null;

    return (
        <div className="chat-page-container">
             <style jsx>{`
                /* Reuse existing WhatsApp Theme variables */
                :root {
                    --wa-bg: #0b141a;
                    --wa-header: #202c33;
                    --wa-outgoing: #0c3e59; 
                    --wa-incoming: #202c33;
                    --wa-input-bg: #2a3942;
                    --wa-text-primary: #e9edef;
                    --wa-text-secondary: #8696a0;
                    --wa-accent: #34b7f1; 
                    --wa-tick-read: #53bdeb; /* Blue for read */
                    --wa-tick-sent: #8696a0; /* Grey for sent */
                }

                .chat-page-container {
                    width: 100%; height: 100vh;
                    background-color: var(--wa-bg);
                    display: flex; flex-direction: column;
                }

                .chat-window {
                    width: 100%; height: 100%;
                    background-color: var(--wa-bg);
                    background-image: radial-gradient(#2a3942 1.5px, transparent 1.5px);
                    background-size: 24px 24px;
                    display: flex; flex-direction: column; overflow: hidden;
                    position: relative;
                }
                
                .chat-header {
                    padding: 10px 16px; 
                    background-color: var(--wa-header); 
                    display: flex; align-items: center; justify-content: space-between; 
                    color: var(--wa-text-primary);
                    z-index: 10;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                    height: 60px; flex-shrink: 0;
                }
                .recipient-info { display: flex; align-items: center; gap: 12px; cursor: pointer; }
                .avatar-circle {
                    width: 40px; height: 40px; background: #6f42c1; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: bold; color: white; font-size: 1.1rem;
                }
                .status-text {
                    font-size: 0.8rem; color: var(--wa-text-secondary); margin-top: 2px;
                    min-height: 1.2em; display: flex; align-items: center; gap: 5px;
                }
                .status-typing { color: var(--wa-accent); font-weight: 500; }

                .chat-body {
                    flex: 1; padding: 20px 5%; 
                    overflow-y: auto;
                    display: flex; flex-direction: column; gap: 6px;
                    background-color: rgba(11, 20, 26, 0.95); 
                }

                /* FIX: Date Separator - Removed Sticky to prevent "intermixing" stack */
                .date-separator {
                    display: flex; justify-content: center; margin: 15px 0;
                    z-index: 5;
                }
                .date-badge {
                    background-color: #1f2c34; color: #8696a0;
                    font-size: 0.75rem; padding: 5px 12px; border-radius: 8px;
                    text-transform: uppercase; font-weight: 500;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.2);
                }

                .message-row { display: flex; width: 100%; position: relative; }
                .row-own { justify-content: flex-end; }
                .row-other { justify-content: flex-start; }

                .message-bubble {
                    max-width: 85%;
                    padding: 6px 7px 8px 9px; 
                    border-radius: 12px; 
                    font-size: 0.95rem; 
                    line-height: 1.35; 
                    position: relative;
                    color: var(--wa-text-primary);
                    box-shadow: 0 1px 0.5px rgba(0,0,0,0.13);
                    display: flex; flex-direction: column;
                }
                @media(min-width: 768px) { .message-bubble { max-width: 60%; } }

                .bubble-own { background-color: var(--wa-outgoing); border-bottom-right-radius: 0; }
                .bubble-other { background-color: var(--wa-incoming); border-bottom-left-radius: 0; }

                .action-btns {
                    position: absolute; top: -8px; right: -8px;
                    background: #202c33; 
                    border-radius: 15px; 
                    padding: 2px 5px;
                    display: none; align-items: center; justify-content: center; gap: 5px;
                    border: 1px solid #333; z-index: 2;
                }
                .message-row:hover .action-btns { display: flex; }
                
                .action-icon {
                    color: var(--wa-text-secondary);
                    width: 20px; height: 20px;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 11px; cursor: pointer;
                    border-radius: 50%;
                    transition: 0.2s;
                }
                .action-icon:hover { background: rgba(255,255,255,0.1); color: var(--wa-text-primary); }
                .action-icon.delete:hover { color: #ef5350; }
                .action-icon.info:hover { color: #34b7f1; }

                .sender-name { font-size: 0.75rem; font-weight: bold; margin-bottom: 4px; color: #d63384; opacity: 0.9; }

                .msg-image { max-width: 100%; border-radius: 6px; margin-bottom: 4px; cursor: pointer; }
                .msg-audio { width: 220px; margin: 5px 0; }
                
                .msg-file-card {
                    display: flex; align-items: center; gap: 10px;
                    background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px;
                    text-decoration: none; color: var(--wa-text-primary);
                    transition: background 0.2s;
                }
                .msg-file-card:hover { background: rgba(0,0,0,0.3); }
                .file-icon-box { font-size: 1.8rem; color: #ff5252; }
                .file-info { display: flex; flex-direction: column; overflow: hidden; }
                .file-name { font-weight: 500; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .file-size { font-size: 0.75rem; color: var(--wa-text-secondary); }

                .msg-meta {
                    display: flex; justify-content: flex-end; align-items: center;
                    margin-top: 2px; gap: 4px;
                }
                .msg-time { font-size: 0.68rem; color: var(--wa-text-secondary); }
                .bubble-own .msg-time { color: rgba(255,255,255,0.7); }

                .read-ticks { font-size: 0.9rem; margin-left: 3px; }
                .read-ticks.blue { color: var(--wa-tick-read); }
                .read-ticks.grey { color: var(--wa-tick-sent); }

                .chat-footer {
                    padding: 8px 10px; background-color: var(--wa-header); 
                    display: flex; align-items: center; gap: 10px; z-index: 10; flex-shrink: 0;
                }
                .chat-input-bar {
                    flex: 1; background-color: var(--wa-input-bg);
                    border-radius: 20px; padding: 10px 16px;
                    border: none; color: var(--wa-text-primary);
                    font-size: 1rem; outline: none;
                }
                .chat-input-bar::placeholder { color: var(--wa-text-secondary); }

                .icon-btn {
                    background: transparent; border: none; 
                    color: var(--wa-text-secondary); font-size: 1.4rem; cursor: pointer; padding: 8px;
                    border-radius: 50%; display: flex; align-items: center; justify-content: center;
                    transition: 0.2s;
                }
                .icon-btn:hover { background: rgba(255,255,255,0.05); color: var(--wa-text-primary); }
                
                .btn-send { color: var(--wa-accent); }
                .btn-mic { color: var(--wa-text-secondary); }
                .btn-mic.recording { 
                    color: #ff3b30; background: rgba(255, 59, 48, 0.1); 
                    animation: pulse 1.5s infinite;
                }

                @keyframes pulse {
                    0% { box-shadow: 0 0 0 0 rgba(255, 59, 48, 0.4); }
                    70% { box-shadow: 0 0 0 10px rgba(255, 59, 48, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(255, 59, 48, 0); }
                }

                .chat-body::-webkit-scrollbar { width: 6px; }
                .chat-body::-webkit-scrollbar-track { background: transparent; }
                .chat-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }

                /* Modals */
                .modal-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.7); z-index: 2000;
                    display: flex; align-items: center; justify-content: center;
                    backdrop-filter: blur(2px);
                }
                .custom-modal {
                    background: var(--wa-header); color: var(--wa-text-primary);
                    padding: 20px; border-radius: 12px; width: 320px; max-width: 90%;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.5); 
                }
                .modal-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 10px; }
                .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
                .btn-modal { padding: 8px 16px; border: none; border-radius: 20px; font-size: 0.9rem; font-weight: 600; cursor: pointer; }
                .btn-modal-cancel { background: transparent; color: var(--wa-accent); border: 1px solid var(--wa-accent); }
                .btn-modal-confirm { background: #ef5350; color: white; }

                /* Info Modal Specifics */
                .reader-list {
                    max-height: 250px; overflow-y: auto; margin-top: 10px;
                }
                .reader-item {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);
                }
                .reader-item:last-child { border-bottom: none; }
                .reader-name { font-weight: 500; }
                .read-status { color: var(--wa-tick-read); font-size: 0.8rem; display: flex; align-items: center; gap: 4px; }
            `}</style>

            <div className="chat-window">
                <div className="chat-header">
                    <div className="recipient-info">
                        <button className="icon-btn me-2" onClick={handleClose}>
                            <i className="bi bi-arrow-left"></i>
                        </button>
                        
                        <div className="avatar-circle">
                            <i className="bi bi-people-fill"></i>
                        </div>
                        <div style={{display: 'flex', flexDirection: 'column'}}>
                            <span style={{fontWeight: 500, fontSize: '1rem'}}>{groupName}</span>
                            <div className="status-text">
                                {typingUsers.length > 0 ? (
                                    <span className="status-typing">
                                        {typingUsers.join(', ')} typing...
                                    </span>
                                ) : (
                                    <span>Tap for info</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="chat-body">
                    {messages.length === 0 && (
                        <div className="text-center mt-5" style={{ color: 'var(--wa-input-bg)', padding: '10px', background: 'rgba(32, 44, 51, 0.5)', borderRadius: '10px', margin: '0 auto', maxWidth: '300px' }}>
                            <small style={{color: 'var(--wa-text-secondary)'}}>
                                <i className="bi bi-lock-fill me-1"></i> Messages are end-to-end encrypted.
                            </small>
                        </div>
                    )}

                    {messages.map((msg, index) => {
                        const isOwn = msg.senderId === user._id;
                        const dateLabel = getDateLabel(msg.timestamp);
                        const prevMsg = messages[index - 1];
                        const prevDateLabel = prevMsg ? getDateLabel(prevMsg.timestamp) : null;
                        const showDate = dateLabel && dateLabel !== prevDateLabel;

                        // Decrypt Text
                        let displayContent = msg.text;
                        if(msg.type === 'text') {
                            displayContent = decryptMessage(msg.text);
                        }

                        // --- BLUE TICK LOGIC ---
                        const isReadByAll = msg.readBy && totalParticipants > 0 && msg.readBy.length >= totalParticipants;

                        return (
                            <React.Fragment key={msg.id}>
                                {showDate && (
                                    <div className="date-separator">
                                        <span className="date-badge">{dateLabel}</span>
                                    </div>
                                )}

                                <div className={`message-row ${isOwn ? 'row-own' : 'row-other'}`}>
                                    <div className={`message-bubble ${isOwn ? 'bubble-own' : 'bubble-other'}`}>
                                        
                                        {/* --- ACTION BUTTONS (DELETE & INFO) --- */}
                                        {isOwn && (
                                            <div className="action-btns">
                                                <div className="action-icon info" onClick={() => handleShowInfo(msg)} title="Message Info">
                                                    <i className="bi bi-info-circle"></i>
                                                </div>
                                                <div className="action-icon delete" onClick={() => promptDelete(msg.id)} title="Delete Message">
                                                    <i className="bi bi-trash"></i>
                                                </div>
                                            </div>
                                        )}

                                        {!isOwn && (
                                            <div className="sender-name">{msg.senderName}</div>
                                        )}

                                        {msg.type === 'image' && (
                                            <a href={msg.fileUrl} target="_blank" rel="noreferrer">
                                                <img src={msg.fileUrl} alt="attachment" className="msg-image" />
                                            </a>
                                        )}
                                        
                                        {msg.type === 'file' && (
                                            <a href={msg.fileUrl} target="_blank" rel="noreferrer" className="msg-file-card">
                                                <div className="file-icon-box"><i className="bi bi-file-earmark-text-fill"></i></div>
                                                <div className="file-info">
                                                    <span className="file-name">{msg.fileName}</span>
                                                    <span className="file-size">{formatBytes(msg.fileSize)}</span>
                                                </div>
                                                <i className="bi bi-download ms-2" style={{color: '#8696a0'}}></i>
                                            </a>
                                        )}

                                        {msg.type === 'audio' && (
                                            <div className="d-flex align-items-center gap-2">
                                                <i className="bi bi-mic-fill" style={{color: isOwn ? '#fff' : '#8696a0'}}></i>
                                                <audio controls src={msg.fileUrl} className="msg-audio" />
                                            </div>
                                        )}

                                        {msg.type === 'text' && <span>{displayContent}</span>}

                                        <div className="msg-meta">
                                            <span className="msg-time">{formatTime(msg.timestamp)}</span>
                                            {isOwn && (
                                                <span className={`read-ticks ${isReadByAll ? 'blue' : 'grey'}`}>
                                                    <i className="bi bi-check2-all"></i>
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </React.Fragment>
                        );
                    })}
                    <div ref={messagesEndRef} />
                </div>

                <div className="chat-footer">
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        style={{ display: 'none' }} 
                        onChange={handleFileUpload}
                    />

                    <button className="icon-btn" title="Attach" onClick={() => fileInputRef.current?.click()} disabled={isUploading || isRecording}>
                        <i className="bi bi-paperclip" style={{transform: 'rotate(45deg)'}}></i>
                    </button>

                    {isRecording ? (
                        <div style={{flex: 1, color: '#ff3b30', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                            Recording...
                        </div>
                    ) : (
                        <form onSubmit={handleSendMessage} style={{display: 'flex', flex: 1, alignItems: 'center', gap: '8px'}}>
                            <input 
                                type="text" 
                                className="chat-input-bar" 
                                placeholder="Type a message" 
                                value={newMessage}
                                onChange={handleTyping}
                            />
                        </form>
                    )}

                    {(newMessage.trim() || isUploading) && !isRecording ? (
                        <button onClick={handleSendMessage} className="icon-btn btn-send" disabled={isUploading}>
                            {isUploading ? <span className="spinner-border spinner-border-sm"></span> : <i className="bi bi-send-fill"></i>}
                        </button>
                    ) : (
                        <button 
                            className={`icon-btn btn-mic ${isRecording ? 'recording' : ''}`}
                            onClick={isRecording ? stopRecording : startRecording}
                            title={isRecording ? "Stop Recording" : "Record Voice"}
                        >
                            <i className={`bi ${isRecording ? 'bi-stop-circle-fill' : 'bi-mic-fill'}`}></i>
                        </button>
                    )}
                </div>
            </div>

            {/* DELETE MODAL */}
            {deleteTargetId && (
                <div className="modal-overlay" onClick={() => setDeleteTargetId(null)}>
                    <div className="custom-modal text-center" onClick={(e) => e.stopPropagation()}>
                        <h5 className="modal-title">Delete Message?</h5>
                        <p>This message will be deleted for everyone in this group.</p>
                        <div className="modal-actions justify-content-center">
                            <button className="btn-modal btn-modal-cancel" onClick={() => setDeleteTargetId(null)}>Cancel</button>
                            <button className="btn-modal btn-modal-confirm" onClick={confirmDeleteMessage}>Delete</button>
                        </div>
                    </div>
                </div>
            )}

            {/* MESSAGE INFO MODAL (READ RECEIPTS) */}
            {infoTargetMessage && (
                <div className="modal-overlay" onClick={closeInfoModal}>
                    <div className="custom-modal" onClick={(e) => e.stopPropagation()}>
                        <h5 className="modal-title">Message Info</h5>
                        <div style={{fontSize: '0.9rem', opacity: 0.8}}>Read by:</div>
                        
                        {isLoadingInfo ? (
                            <div className="text-center p-3">
                                <span className="spinner-border spinner-border-sm"></span> Loading...
                            </div>
                        ) : (
                            <div className="reader-list">
                                {readByUsersData.length === 0 ? (
                                    <div className="p-2 text-center text-muted">Not read by anyone else yet.</div>
                                ) : (
                                    readByUsersData.map((reader) => (
                                        <div key={reader.id} className="reader-item">
                                            <span className="reader-name">{reader.name}</span>
                                            <span className="read-status">
                                                <i className="bi bi-check2-all"></i> Read
                                            </span>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}

                        <div className="modal-actions">
                            <button className="btn-modal btn-modal-cancel" onClick={closeInfoModal}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GroupChat;