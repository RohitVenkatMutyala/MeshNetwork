import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { db, storage } from '../firebaseConfig';
import { 
    collection, query, orderBy, onSnapshot, addDoc, 
    serverTimestamp, doc, setDoc, deleteDoc, getDoc, updateDoc, arrayUnion, getDocs, where
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { toast } from 'react-toastify';
import { v4 as uuidv4 } from 'uuid';
import CryptoJS from 'crypto-js';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const SECRET_KEY = process.env.REACT_APP_KEY; 

// --- SECURE MEDIA COMPONENTS (Decrypts files on display) ---

const SecureImage = ({ url, secretKey }) => {
    const [src, setSrc] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;
        const fetchAndDecrypt = async () => {
            try {
                const response = await fetch(url);
                const encryptedText = await response.text();
                const bytes = CryptoJS.AES.decrypt(encryptedText, secretKey);
                const decryptedData = bytes.toString(CryptoJS.enc.Utf8);
                if (isMounted) {
                    setSrc(decryptedData.startsWith('data:') ? decryptedData : url);
                    setLoading(false);
                }
            } catch (err) {
                if (isMounted) { setSrc(url); setLoading(false); }
            }
        };
        fetchAndDecrypt();
        return () => { isMounted = false; };
    }, [url, secretKey]);

    if (loading) return <div className="p-3 text-white text-center" style={{fontSize:'0.8rem'}}>Decrypting Image...</div>;
    return <img src={src} alt="attachment" className="msg-image" />;
};

const SecureAudio = ({ url, secretKey }) => {
    const [src, setSrc] = useState(null);

    useEffect(() => {
        const fetchAndDecrypt = async () => {
            try {
                const response = await fetch(url);
                const encryptedText = await response.text();
                const bytes = CryptoJS.AES.decrypt(encryptedText, secretKey);
                const decryptedData = bytes.toString(CryptoJS.enc.Utf8);
                setSrc(decryptedData.startsWith('data:') ? decryptedData : url);
            } catch (err) {
                setSrc(url);
            }
        };
        fetchAndDecrypt();
    }, [url, secretKey]);

    if (!src) return <span style={{color: '#8696a0', fontSize:'0.75rem'}}>Decrypting Audio...</span>;
    return <audio controls src={src} className="msg-audio" />;
};

const SecureFileDownload = ({ url, fileName, fileSize, secretKey }) => {
    const [decryptedHref, setDecryptedHref] = useState(null);
    const [decrypting, setDecrypting] = useState(false);

    const handleDownloadClick = async (e) => {
        if (decryptedHref) return; 
        e.preventDefault();
        setDecrypting(true);
        try {
            const response = await fetch(url);
            const encryptedText = await response.text();
            const bytes = CryptoJS.AES.decrypt(encryptedText, secretKey);
            const decryptedData = bytes.toString(CryptoJS.enc.Utf8);
            
            const link = document.createElement("a");
            link.href = decryptedData;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setDecryptedHref(decryptedData); 
        } catch (err) {
            window.open(url, '_blank'); 
        } finally {
            setDecrypting(false);
        }
    };

    const formatBytes = (bytes, decimals = 2) => {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
    };

    return (
        <a href={decryptedHref || url} onClick={handleDownloadClick} className="msg-file-card" style={{cursor: 'pointer'}}>
            <div className="file-icon-box"><i className="bi bi-file-earmark-text-fill"></i></div>
            <div className="file-info">
                <span className="file-name">{fileName}</span>
                <span className="file-size">{formatBytes(fileSize)}</span>
            </div>
            <div style={{color: '#8696a0', marginLeft: '10px'}}>
                {decrypting ? <span className="spinner-border spinner-border-sm"></span> : <i className="bi bi-download"></i>}
            </div>
        </a>
    );
};

// --- MAIN GROUP CHAT COMPONENT ---

const GroupChat = () => {
    const { user } = useAuth();
    const { theme } = useTheme();
    const { chatId } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    
    // --- SAFE NAME LOGIC ---
    const currentUserName = user ? (
        user.name || user.displayName || 
        (user.firstname && user.lastname ? `${user.firstname} ${user.lastname}` : null) || 
        user.email || "Unknown User"
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
    const encryptText = (text) => CryptoJS.AES.encrypt(text, SECRET_KEY).toString();
    const decryptText = (cipherText) => {
        try {
            const bytes = CryptoJS.AES.decrypt(cipherText, SECRET_KEY);
            const decrypted = bytes.toString(CryptoJS.enc.Utf8);
            return decrypted || cipherText;
        } catch (error) {
            return cipherText;
        }
    };

    // Helper: Read File as Base64
    const readFileAsBase64 = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
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

        const messagesRef = collection(db, 'group_chats', chatId, 'messages');
        const q = query(messagesRef, orderBy('timestamp', 'asc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const msgs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setMessages(msgs);

            // Read Receipt Logic
            snapshot.docs.forEach(async (docSnap) => {
                const data = docSnap.data();
                const readBy = data.readBy || [];
                
                const hasRead = readBy.some(item => 
                    (typeof item === 'string' && item === user._id) || 
                    (typeof item === 'object' && item.uid === user._id)
                );

                if (data.senderId !== user._id && !hasRead) {
                    try {
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
                typing: { [user._id]: { isTyping: true, name: currentUserName } } 
            }, { merge: true });
        }

        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        
        typingTimeoutRef.current = setTimeout(async () => {
            setIsTyping(false);
            const chatDocRef = doc(db, 'group_chats', chatId);
            await setDoc(chatDocRef, { 
                typing: { [user._id]: { isTyping: false, name: currentUserName } } 
            }, { merge: true });
        }, 2000);
    };

    // --- 3. Send Message (Encrypted) ---
    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim()) return;

        try {
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            await setDoc(doc(db, 'group_chats', chatId), { 
                typing: { [user._id]: { isTyping: false } } 
            }, { merge: true });
            setIsTyping(false);

            const encryptedText = encryptText(newMessage);

            await addDoc(collection(db, 'group_chats', chatId, 'messages'), {
                text: encryptedText, 
                type: 'text',
                senderName: currentUserName,
                senderId: user._id,
                senderEmail: user.email,
                timestamp: serverTimestamp(),
                readBy: [{ uid: user._id, name: currentUserName }]
            });
            setNewMessage('');
        } catch (error) {
            console.error("Error sending message:", error);
            toast.error("Failed to send message.");
        }
    };

    // --- 4. Encrypted File Upload ---
    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > MAX_FILE_SIZE) {
            toast.error("File is too large. Max size is 10MB.");
            return;
        }

        setIsUploading(true);
        try {
            // 1. Read & Encrypt
            const base64Data = await readFileAsBase64(file);
            const encryptedData = CryptoJS.AES.encrypt(base64Data, SECRET_KEY).toString();
            const encryptedBlob = new Blob([encryptedData], { type: 'text/plain' });

            const isImage = file.type.startsWith('image/');
            const msgType = isImage ? 'image' : 'file';
            const fileId = uuidv4();
            const filePath = `groupChatFiles/${chatId}/${fileId}-${file.name}.txt`;
            const storageRef = ref(storage, filePath);

            const snapshot = await uploadBytes(storageRef, encryptedBlob);
            const downloadURL = await getDownloadURL(snapshot.ref);

            await addDoc(collection(db, 'group_chats', chatId, 'messages'), {
                type: msgType,
                fileUrl: downloadURL,
                fileName: file.name,
                fileSize: file.size,
                isEncrypted: true,
                senderName: currentUserName,
                senderId: user._id,
                senderEmail: user.email,
                timestamp: serverTimestamp(),
                readBy: [{ uid: user._id, name: currentUserName }]
            });

        } catch (error) {
            console.error("Upload failed:", error);
            toast.error("Failed to upload file.");
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // --- 5. Encrypted Voice Recording ---
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
            const reader = new FileReader();
            reader.readAsDataURL(blob); 
            reader.onloadend = async () => {
                const base64Audio = reader.result;
                const encryptedAudio = CryptoJS.AES.encrypt(base64Audio, SECRET_KEY).toString();
                const encryptedBlob = new Blob([encryptedAudio], { type: 'text/plain' });

                const fileId = uuidv4();
                const filePath = `groupChatVoice/${chatId}/${fileId}.txt`;
                const storageRef = ref(storage, filePath);
                
                const snapshot = await uploadBytes(storageRef, encryptedBlob);
                const downloadURL = await getDownloadURL(snapshot.ref);

                await addDoc(collection(db, 'group_chats', chatId, 'messages'), {
                    type: 'audio',
                    fileUrl: downloadURL,
                    fileName: 'Voice Message',
                    isEncrypted: true,
                    senderName: currentUserName,
                    senderId: user._id,
                    senderEmail: user.email,
                    timestamp: serverTimestamp(),
                    readBy: [{ uid: user._id, name: currentUserName }]
                });
                setIsUploading(false);
            };
        } catch (error) {
            toast.error("Failed to send voice message.");
            setIsUploading(false);
        }
    };

    // --- Handlers ---
    const promptDelete = (messageId) => setDeleteTargetId(messageId);
    
    const handleShowInfo = (msg) => {
        setInfoTargetMessage(msg);
        const readers = (msg.readBy || [])
            .filter(item => {
                const itemId = typeof item === 'string' ? item : item.uid;
                return itemId !== msg.senderId;
            })
            .map(item => {
                if (typeof item === 'object' && item.name) {
                    return { id: item.uid, name: item.name };
                }
                return { id: item, name: "Unknown (Old Message)" };
            });
        setReadByUsersData(readers);
        setIsLoadingInfo(false);
    };

    const closeInfoModal = () => {
        setInfoTargetMessage(null);
        setReadByUsersData([]);
    };

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

    // --- Helpers ---
    const formatTime = (timestamp) => {
        if (!timestamp) return '...';
        return timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
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
    // --- TEXT FORMATTING HELPER (Links + Bold + Newlines) ---
    const renderFormattedText = (text) => {
        if (!text) return null;

        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const boldRegex = /(\*[^*]+\*)/g;

        // 1. Split by URLs first
        const parts = text.split(urlRegex);

        return (
            <span className="msg-text-content">
                {parts.map((part, index) => {
                    // Check if it's a URL
                    if (part.match(urlRegex)) {
                        return (
                            <a 
                                key={index} 
                                href={part} 
                                target="_blank" 
                                rel="noopener noreferrer" 
                                className="msg-link"
                            >
                                {part}
                            </a>
                        );
                    }

                    // Check for Bold formatting inside regular text
                    const subParts = part.split(boldRegex);
                    return (
                        <span key={index}>
                            {subParts.map((subPart, subIndex) => {
                                if (subPart.match(boldRegex)) {
                                    // Remove asterisks and wrap in <strong>
                                    return <strong key={subIndex}>{subPart.slice(1, -1)}</strong>;
                                }
                                return subPart;
                            })}
                        </span>
                    );
                })}
            </span>
        );
    };

    if (!user) return null;

    return (
        <div className="chat-page-container">
         <style jsx>{`
                :root {
                    /* --- DYNAMIC THEME VARIABLES --- */
                    
                    /* Backgrounds */
                    /* Dark: Your Original #0b141a | Light: White */
                    --wa-bg: ${theme === 'dark' ? '#0b141a' : '#ffffff'};
                    
                    /* Header/Footer/Modals */
                    /* Dark: Your Original #202c33 | Light: Light Gray */
                    --wa-header: ${theme === 'dark' ? '#202c33' : '#f0f2f5'};
                    
                    /* Input Field */
                    /* Dark: Your Original #2a3942 | Light: White */
                    --wa-input-bg: ${theme === 'dark' ? '#2a3942' : '#ffffff'};
                    
                    /* Message Bubbles */
                    /* Dark: Your Original #0c3e59 (Blue) | Light: Very Light Blue */
                    --wa-outgoing: ${theme === 'dark' ? '#0c3e59' : '#e1f5fe'};
                    /* Dark: Your Original #202c33 | Light: White */
                    --wa-incoming: ${theme === 'dark' ? '#202c33' : '#ffffff'};
                    
                    /* Text Colors */
                    --wa-text-primary: ${theme === 'dark' ? '#e9edef' : '#111b21'};
                    --wa-text-secondary: ${theme === 'dark' ? '#8696a0' : '#54656f'};
                    
                    /* Accents */
                    --wa-accent: ${theme === 'dark' ? '#34b7f1' : '#0088cc'};
                    --wa-tick-read: #53bdeb;
                    --wa-tick-sent: ${theme === 'dark' ? '#8696a0' : '#667781'};
                    
                    /* Background Pattern (Subtle) */
                    --wa-bg-pattern: ${theme === 'dark' ? '#2a3942' : 'rgba(0,0,0,0.05)'};
                }

                .chat-page-container { width: 100%; height: 100vh; background-color: var(--wa-bg); display: flex; flex-direction: column; transition: background-color 0.3s ease; }
                
                .chat-window { 
                    width: 100%; height: 100%; 
                    background-color: var(--wa-bg); 
                    /* Dynamic Pattern */
                    background-image: radial-gradient(var(--wa-bg-pattern) 1.5px, transparent 1.5px); 
                    background-size: 24px 24px; 
                    display: flex; flex-direction: column; 
                    overflow: hidden; position: relative; 
                }

                .chat-header { padding: 10px 16px; background-color: var(--wa-header); display: flex; align-items: center; justify-content: space-between; color: var(--wa-text-primary); z-index: 10; box-shadow: 0 1px 3px rgba(0,0,0,0.1); height: 60px; flex-shrink: 0; }
                .recipient-info { display: flex; align-items: center; gap: 12px; cursor: pointer; }
                .avatar-circle { width: 40px; height: 40px; background: #6f42c1; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; color: white; font-size: 1.1rem; }
                .status-text { font-size: 0.8rem; color: var(--wa-text-secondary); margin-top: 2px; min-height: 1.2em; display: flex; align-items: center; gap: 5px; }
                .status-typing { color: var(--wa-accent); font-weight: 500; }
                .chat-body { flex: 1; padding: 20px 5%; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; background-color: transparent; }
                
                /* --- DATE SEPARATOR --- */
                .date-separator {
                    display: flex;
                    justify-content: center;
                    margin: 20px 0 12px 0;
                    width: 100%;
                    z-index: 1;
                }
                .date-badge { background-color: var(--wa-header); color: var(--wa-text-secondary); font-size: 0.75rem; padding: 5px 12px; border-radius: 8px; text-transform: uppercase; font-weight: 500; box-shadow: 0 1px 2px rgba(0,0,0,0.2); }
                
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
                    display: flex; 
                    flex-direction: column;
                    word-wrap: break-word; 
                    overflow-wrap: break-word; 
                    word-break: break-word;
                }
                
                /* LINKS AND FORMATTING */
                .msg-text-content { white-space: pre-wrap; }
                .msg-link { color: var(--wa-accent); text-decoration: underline; word-break: break-all; }

                @media(min-width: 768px) { .message-bubble { max-width: 60%; } }
                
                .bubble-own { 
                    background-color: var(--wa-outgoing); 
                    border-bottom-right-radius: 0;
                    color: var(--wa-text-primary);
                }
                .bubble-other { background-color: var(--wa-incoming); border-bottom-left-radius: 0; }
                
                .action-btns { position: absolute; top: -8px; right: -8px; background: var(--wa-header); border-radius: 15px; padding: 2px 5px; display: none; align-items: center; justify-content: center; gap: 5px; border: 1px solid var(--wa-bg); z-index: 2; }
                .message-row:hover .action-btns { display: flex; }
                .action-icon { color: var(--wa-text-secondary); width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 11px; cursor: pointer; border-radius: 50%; transition: 0.2s; }
                .action-icon:hover { background: rgba(128,128,128,0.2); color: var(--wa-text-primary); }
                .action-icon.delete:hover { color: #ef5350; }
                .action-icon.info:hover { color: var(--wa-accent); }

                .sender-name { font-size: 0.75rem; font-weight: bold; margin-bottom: 4px; color: #d63384; opacity: 0.9; }
                .msg-image { max-width: 100%; border-radius: 6px; margin-bottom: 4px; cursor: pointer; }
                .msg-audio { width: 220px; margin: 5px 0; }
                .msg-file-card { display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,0.1); padding: 10px; border-radius: 6px; text-decoration: none; color: var(--wa-text-primary); transition: background 0.2s; }
                .msg-file-card:hover { background: rgba(0,0,0,0.2); }
                .file-icon-box { font-size: 1.8rem; color: #ff5252; }
                .file-info { display: flex; flex-direction: column; overflow: hidden; }
                .file-name { font-weight: 500; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .file-size { font-size: 0.75rem; color: var(--wa-text-secondary); }
                
                .msg-meta { display: flex; justify-content: flex-end; align-items: center; margin-top: 2px; gap: 4px; }
                .msg-time { font-size: 0.68rem; color: var(--wa-text-secondary); }
                
                /* Fix timestamp color visibility for Light mode in Own bubbles */
                .bubble-own .msg-time { 
                    color: ${theme === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.45)'}; 
                }

                .read-ticks { font-size: 0.9rem; margin-left: 3px; }
                .read-ticks.blue { color: var(--wa-tick-read); }
                .read-ticks.grey { color: var(--wa-tick-sent); }
                
                .chat-footer { padding: 8px 10px; background-color: var(--wa-header); display: flex; align-items: center; gap: 10px; z-index: 10; flex-shrink: 0; }
                .chat-input-bar { flex: 1; background-color: var(--wa-input-bg); border-radius: 20px; padding: 10px 16px; border: none; color: var(--wa-text-primary); font-size: 1rem; outline: none; }
                .chat-input-bar::placeholder { color: var(--wa-text-secondary); }
                
                .icon-btn { background: transparent; border: none; color: var(--wa-text-secondary); font-size: 1.4rem; cursor: pointer; padding: 8px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: 0.2s; }
                .icon-btn:hover { background: rgba(128,128,128,0.1); color: var(--wa-text-primary); }
                .btn-send { color: var(--wa-accent); }
                .btn-mic { color: var(--wa-text-secondary); }
                .btn-mic.recording { color: #ff3b30; background: rgba(255, 59, 48, 0.1); animation: pulse 1.5s infinite; }
                
                @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(255, 59, 48, 0.4); } 70% { box-shadow: 0 0 0 10px rgba(255, 59, 48, 0); } 100% { box-shadow: 0 0 0 0 rgba(255, 59, 48, 0); } }
                
                .chat-body::-webkit-scrollbar { width: 6px; }
                .chat-body::-webkit-scrollbar-track { background: transparent; }
                .chat-body::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.3); border-radius: 3px; }
                
                /* MODALS CSS */
                .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 2000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(2px); }
                .custom-modal { background: var(--wa-header); color: var(--wa-text-primary); padding: 20px; border-radius: 12px; width: 320px; max-width: 90%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
                .modal-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 10px; }
                .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
                .btn-modal { padding: 8px 16px; border: none; border-radius: 20px; font-size: 0.9rem; font-weight: 600; cursor: pointer; }
                .btn-modal-cancel { background: transparent; color: var(--wa-accent); border: 1px solid var(--wa-accent); }
                .btn-modal-confirm { background: #ef5350; color: white; }
                .reader-list { max-height: 250px; overflow-y: auto; margin-top: 10px; }
                .reader-item { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--wa-bg); }
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
                        <div className="avatar-circle"> <i className="bi bi-people-fill"></i> </div>
                        <div style={{display: 'flex', flexDirection: 'column'}}>
                            <span style={{fontWeight: 500, fontSize: '1rem'}}>{groupName}</span>
                            <div className="status-text">
                                {typingUsers.length > 0 ? (
                                    <span className="status-typing">{typingUsers.join(', ')} typing...</span>
                                ) : <span></span>}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="chat-body">
                    {messages.length === 0 && (
                        <div className="text-center mt-5" style={{ color: 'var(--wa-input-bg)', padding: '10px', background: 'rgba(32, 44, 51, 0.5)', borderRadius: '10px', margin: '0 auto', maxWidth: '300px' }}>
                            <small style={{color: 'var(--wa-text-secondary)'}}>
                                <i className="bi bi-lock-fill me-1"></i> Messages & Files are end-to-end encrypted.
                            </small>
                        </div>
                    )}

                    {messages.map((msg, index) => {
                        const isOwn = msg.senderId === user._id;
                        const dateLabel = getDateLabel(msg.timestamp);
                        const prevMsg = messages[index - 1];
                        const showDate = dateLabel && dateLabel !== (prevMsg ? getDateLabel(prevMsg.timestamp) : null);

                        let displayContent = msg.text;
                        if(msg.type === 'text') displayContent = decryptText(msg.text);

                        // Blue Tick Logic: Check if EVERYONE (or totalParticipants) has read it.
                        const readByCount = msg.readBy ? msg.readBy.length : 0;
                        // Assuming self is always read, so we need other participants
                        const isReadByAll = totalParticipants > 0 && readByCount >= totalParticipants;

                        return (
                            <React.Fragment key={msg.id}>
                                {showDate && <div className="date-separator"><span className="date-badge">{dateLabel}</span></div>}

                                <div className={`message-row ${isOwn ? 'row-own' : 'row-other'}`}>
                                    <div className={`message-bubble ${isOwn ? 'bubble-own' : 'bubble-other'}`}>
                                        
                                        {isOwn && (
                                            <div className="action-btns">
                                                <div className="action-icon info" onClick={() => handleShowInfo(msg)} title="Info"><i className="bi bi-info-circle"></i></div>
                                                <div className="action-icon delete" onClick={() => promptDelete(msg.id)} title="Delete"><i className="bi bi-trash"></i></div>
                                            </div>
                                        )}

                                        {!isOwn && <div className="sender-name">{msg.senderName}</div>}

                                        {/* ENCRYPTED MEDIA RENDERING */}
                                        {msg.type === 'image' && (
                                            msg.isEncrypted ? <SecureImage url={msg.fileUrl} secretKey={SECRET_KEY} /> : 
                                            <a href={msg.fileUrl} target="_blank" rel="noreferrer"><img src={msg.fileUrl} alt="attachment" className="msg-image" /></a>
                                        )}
                                        
                                        {msg.type === 'file' && (
                                            msg.isEncrypted ? <SecureFileDownload url={msg.fileUrl} fileName={msg.fileName} fileSize={msg.fileSize} secretKey={SECRET_KEY} /> :
                                            <a href={msg.fileUrl} target="_blank" rel="noreferrer" className="msg-file-card">
                                                <div className="file-icon-box"><i className="bi bi-file-earmark-text-fill"></i></div>
                                                <div className="file-info"><span className="file-name">{msg.fileName}</span></div>
                                                <i className="bi bi-download ms-2" style={{color: '#8696a0'}}></i>
                                            </a>
                                        )}

                                        {msg.type === 'audio' && (
                                            <div className="d-flex align-items-center gap-2">
                                                <i className="bi bi-mic-fill" style={{color: isOwn ? '#fff' : '#8696a0'}}></i>
                                                {msg.isEncrypted ? <SecureAudio url={msg.fileUrl} secretKey={SECRET_KEY} /> : <audio controls src={msg.fileUrl} className="msg-audio" />}
                                            </div>
                                        )}

                                       {msg.type === 'text' && renderFormattedText(displayContent)}
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
                    <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
                    <button className="icon-btn" title="Attach" onClick={() => fileInputRef.current?.click()} disabled={isUploading || isRecording}>
                        <i className="bi bi-paperclip" style={{transform: 'rotate(45deg)'}}></i>
                    </button>

                    {isRecording ? (
                        <div style={{flex: 1, color: '#ff3b30', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>Recording...</div>
                    ) : (
                        <form onSubmit={handleSendMessage} style={{display: 'flex', flex: 1, alignItems: 'center', gap: '8px'}}>
                            <input type="text" className="chat-input-bar" placeholder="Type a message" value={newMessage} onChange={handleTyping} />
                        </form>
                    )}

                    {(newMessage.trim() || isUploading) && !isRecording ? (
                        <button onClick={handleSendMessage} className="icon-btn btn-send" disabled={isUploading}>
                            {isUploading ? <span className="spinner-border spinner-border-sm"></span> : <i className="bi bi-send-fill"></i>}
                        </button>
                    ) : (
                        <button className={`icon-btn btn-mic ${isRecording ? 'recording' : ''}`} onClick={isRecording ? stopRecording : startRecording}>
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
                        <p>This message will be deleted for everyone.</p>
                        <div className="modal-actions justify-content-center">
                            <button className="btn-modal btn-modal-cancel" onClick={() => setDeleteTargetId(null)}>Cancel</button>
                            <button className="btn-modal btn-modal-confirm" onClick={confirmDeleteMessage}>Delete</button>
                        </div>
                    </div>
                </div>
            )}

            {/* INFO MODAL */}
            {infoTargetMessage && (
                <div className="modal-overlay" onClick={closeInfoModal}>
                    <div className="custom-modal" onClick={(e) => e.stopPropagation()}>
                        <h5 className="modal-title">Message Info</h5>
                        <div style={{fontSize: '0.9rem', opacity: 0.8}}>Read by:</div>
                        {isLoadingInfo ? (
                            <div className="text-center p-3"><span className="spinner-border spinner-border-sm"></span> Loading...</div>
                        ) : (
                            <div className="reader-list">
                                {readByUsersData.length === 0 ? <div className="p-2 text-center text-muted">Not read by anyone else yet.</div> : (
                                    readByUsersData.map((reader) => (
                                        <div key={reader.id} className="reader-item">
                                            <span className="reader-name">{reader.name}</span>
                                            <span className="read-status"><i className="bi bi-check2-all"></i> Read</span>
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