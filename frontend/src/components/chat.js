import React, { useState, useEffect, useRef } from 'react';
// ADD: useParams, useLocation, useNavigate
import { useParams, useLocation, useNavigate } from 'react-router-dom'; 
import { db, storage } from '../firebaseConfig';
import { 
    collection, query, orderBy, onSnapshot, addDoc, 
    serverTimestamp, doc, setDoc 
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import { v4 as uuidv4 } from 'uuid';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// REMOVE props arguments, use hooks instead
const Chat = () => {
    const { user } = useAuth();
    // GET params from URL
    const { collectionName, chatId } = useParams(); 
    // GET recipientName from navigation state (passed from RecentCalls)
    const location = useLocation();
    const navigate = useNavigate();
    
    // Fallback if name isn't passed (e.g., page refresh)
    const recipientName = location.state?.recipientName || 'Chat';

    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [isOtherTyping, setIsOtherTyping] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    
    const messagesEndRef = useRef(null);
    const typingTimeoutRef = useRef(null);
    const fileInputRef = useRef(null);

    // Handle Back Button
    const handleClose = () => {
        navigate(-1); // Go back to previous page
    };

    // --- 1. Auto-scroll to bottom ---
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOtherTyping]);

    // --- 2. Fetch Messages ---
    useEffect(() => {
        if (!chatId || !collectionName) return;

        const messagesRef = collection(db, collectionName, chatId, 'messages');
        const q = query(messagesRef, orderBy('timestamp', 'asc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const msgs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setMessages(msgs);
        }, (error) => {
            console.error("Error fetching messages:", error);
        });

        return () => unsubscribe();
    }, [chatId, collectionName]);

    // --- 3. Typing Indicator Logic ---
    useEffect(() => {
        if (!chatId || !user) return;

        const chatDocRef = doc(db, collectionName, chatId);
        
        const unsubscribe = onSnapshot(chatDocRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();
                const typingData = data.typing || {};
                const someoneElseTyping = Object.keys(typingData).some(
                    userId => userId !== user._id && typingData[userId] === true
                );
                setIsOtherTyping(someoneElseTyping);
            }
        });

        return () => unsubscribe();
    }, [chatId, collectionName, user]);

    const handleTyping = async (e) => {
        setNewMessage(e.target.value);

        if (!user || !chatId) return;

        if (!isTyping) {
            setIsTyping(true);
            const chatDocRef = doc(db, collectionName, chatId);
            await setDoc(chatDocRef, { 
                typing: { [user._id]: true } 
            }, { merge: true });
        }

        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        
        typingTimeoutRef.current = setTimeout(async () => {
            setIsTyping(false);
            const chatDocRef = doc(db, collectionName, chatId);
            await setDoc(chatDocRef, { 
                typing: { [user._id]: false } 
            }, { merge: true });
        }, 2000);
    };

    // --- 4. Send Text Message ---
    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim()) return;

        try {
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            const chatDocRef = doc(db, collectionName, chatId);
            await setDoc(chatDocRef, { typing: { [user._id]: false } }, { merge: true });
            setIsTyping(false);

            await addDoc(collection(db, collectionName, chatId, 'messages'), {
                text: newMessage,
                type: 'text',
                senderName: `${user.firstname} ${user.lastname}`,
                senderId: user._id,
                senderEmail: user.email,
                timestamp: serverTimestamp()
            });
            setNewMessage('');
        } catch (error) {
            console.error("Error sending message:", error);
            toast.error("Failed to send message.");
        }
    };

    // --- 5. Handle File/Image Upload ---
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
            const filePath = `chatFiles/${chatId}/${fileId}-${file.name}`;
            const storageRef = ref(storage, filePath);

            const snapshot = await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(snapshot.ref);

            await addDoc(collection(db, collectionName, chatId, 'messages'), {
                type: msgType,
                fileUrl: downloadURL,
                fileName: file.name,
                fileSize: file.size,
                senderName: `${user.firstname} ${user.lastname}`,
                senderId: user._id,
                senderEmail: user.email,
                timestamp: serverTimestamp()
            });

        } catch (error) {
            console.error("Upload failed:", error);
            toast.error("Failed to upload file.");
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const triggerFileInput = () => {
        fileInputRef.current?.click();
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return '...';
        return timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    };

    const formatBytes = (bytes, decimals = 2) => {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    };

    if (!user) return null;

    return (
        // Changed container class
        <div className="chat-page-container">
            <style jsx>{`
                /* Colors */
                :root {
                    --wa-bg: #0b141a;
                    --wa-header: #202c33;
                    --wa-panel: #111b21;
                    --wa-outgoing: #005c4b;
                    --wa-incoming: #202c33;
                    --wa-input-bg: #2a3942;
                    --wa-text-primary: #e9edef;
                    --wa-text-secondary: #8696a0;
                    --wa-accent: #00a884;
                }

                /* UPDATED: Main Page Container - No longer a modal overlay */
                .chat-page-container {
                    width: 100%;
                    height: 100vh; /* Full viewport height */
                    background-color: var(--wa-bg);
                    display: flex;
                    flex-direction: column;
                }

                /* UPDATED: Window takes full size */
                .chat-window {
                    width: 100%; 
                    height: 100%;
                    background-color: var(--wa-bg);
                    background-image: url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png");
                    background-repeat: repeat;
                    background-size: 400px;
                    display: flex; 
                    flex-direction: column; 
                    overflow: hidden;
                    position: relative;
                }
                
                /* Header */
                .chat-header {
                    padding: 10px 16px; 
                    background-color: var(--wa-header); 
                    display: flex; align-items: center; justify-content: space-between; 
                    color: var(--wa-text-primary);
                    z-index: 10;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                    height: 60px; /* Fixed height for header */
                    flex-shrink: 0;
                }
                .recipient-info { display: flex; align-items: center; gap: 12px; cursor: pointer; }
                .avatar-circle {
                    width: 40px; height: 40px; background: #607d8b; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: bold; color: white; font-size: 1.1rem;
                }
                .status-text {
                    font-size: 0.8rem; color: var(--wa-text-secondary); margin-top: 2px;
                    min-height: 1.2em;
                }
                .status-typing { color: var(--wa-accent); font-weight: 500; }

                /* Body */
                .chat-body {
                    flex: 1; 
                    padding: 20px 5%; 
                    overflow-y: auto;
                    display: flex; flex-direction: column; gap: 8px;
                    background-color: rgba(11, 20, 26, 0.93); 
                }

                /* Messages */
                .message-row { display: flex; width: 100%; }
                .row-own { justify-content: flex-end; }
                .row-other { justify-content: flex-start; }

                .message-bubble {
                    max-width: 85%; /* Slightly wider for full page */
                    padding: 6px 7px 8px 9px; 
                    border-radius: 7.5px;
                    font-size: 0.95rem; 
                    line-height: 1.35; 
                    position: relative;
                    color: var(--wa-text-primary);
                    box-shadow: 0 1px 0.5px rgba(0,0,0,0.13);
                    display: flex; flex-direction: column;
                }
                
                @media(min-width: 768px) {
                    .message-bubble { max-width: 65%; }
                }

                .bubble-own { background-color: var(--wa-outgoing); border-top-right-radius: 0; }
                .bubble-own::after {
                    content: ""; position: absolute; top: 0; right: -8px;
                    width: 0; height: 0;
                    border-top: 8px solid var(--wa-outgoing);
                    border-right: 8px solid transparent; 
                }

                .bubble-other { background-color: var(--wa-incoming); border-top-left-radius: 0; }
                .bubble-other::after {
                    content: ""; position: absolute; top: 0; left: -8px;
                    width: 0; height: 0;
                    border-top: 8px solid var(--wa-incoming);
                    border-left: 8px solid transparent; 
                }

                .sender-name { font-size: 0.75rem; font-weight: bold; margin-bottom: 4px; color: #d1d7db; opacity: 0.7; }
                
                /* Message Content Types */
                .msg-image { max-width: 100%; border-radius: 6px; margin-bottom: 4px; cursor: pointer; }
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

                .msg-time {
                    font-size: 0.68rem; color: var(--wa-text-secondary);
                    align-self: flex-end; margin-top: 2px; margin-left: 10px;
                    min-width: fit-content;
                }
                .bubble-own .msg-time { color: rgba(255,255,255,0.6); }

                /* Footer */
                .chat-footer {
                    padding: 8px 10px; 
                    background-color: var(--wa-header); 
                    display: flex; align-items: center; gap: 10px;
                    z-index: 10;
                    flex-shrink: 0;
                }
                
                .chat-input-bar {
                    flex: 1; 
                    background-color: var(--wa-input-bg);
                    border-radius: 8px;
                    padding: 9px 12px;
                    border: none;
                    color: var(--wa-text-primary);
                    font-size: 1rem;
                    outline: none;
                }
                .chat-input-bar::placeholder { color: var(--wa-text-secondary); }

                .icon-btn {
                    background: transparent; border: none; 
                    color: var(--wa-text-secondary); 
                    font-size: 1.5rem; cursor: pointer; padding: 8px;
                    border-radius: 50%; display: flex; align-items: center; justify-content: center;
                    transition: 0.2s;
                }
                .icon-btn:hover { background: rgba(255,255,255,0.05); color: var(--wa-text-primary); }
                
                .btn-send { color: var(--wa-accent); }
                .btn-send:hover { background: rgba(0,168,132,0.1); }

                /* Scrollbar */
                .chat-body::-webkit-scrollbar { width: 6px; }
                .chat-body::-webkit-scrollbar-track { background: transparent; }
                .chat-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }

                /* Typing Animation */
                .typing-dots span {
                    display: inline-block; width: 4px; height: 4px; border-radius: 50%;
                    background-color: var(--wa-accent); margin-right: 2px;
                    animation: typing 1.4s infinite ease-in-out both;
                }
                .typing-dots span:nth-child(1) { animation-delay: -0.32s; }
                .typing-dots span:nth-child(2) { animation-delay: -0.16s; }
                @keyframes typing {
                    0%, 80%, 100% { transform: scale(0); }
                    40% { transform: scale(1); }
                }
            `}</style>

            <div className="chat-window">
                {/* Header */}
                <div className="chat-header">
                    <div className="recipient-info">
                        {/* Added Back Button for Mobile/Full Page */}
                        <button className="icon-btn me-2" onClick={handleClose}>
                             <i className="bi bi-arrow-left"></i>
                        </button>
                        
                        <div className="avatar-circle">
                            {recipientName ? recipientName.charAt(0).toUpperCase() : '?'}
                        </div>
                        <div style={{display: 'flex', flexDirection: 'column'}}>
                            <span style={{fontWeight: 500, fontSize: '1rem'}}>{recipientName || 'Unknown'}</span>
                            <div className="status-text">
                                {isOtherTyping ? (
                                    <span className="status-typing typing-dots">
                                        typing<span></span><span></span><span></span>
                                    </span>
                                ) : (
                                    <span style={{fontSize: '0.75rem'}}>
                                        {collectionName === 'direct_chats' ? 'Online' : 'In Call'}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    {/* Close button can also act as back button */}
                    <button className="icon-btn" onClick={handleClose} style={{marginLeft: 'auto'}}>
                        <i className="bi bi-x-lg"></i>
                    </button>
                </div>

                {/* Messages Body */}
                <div className="chat-body">
                    {messages.length === 0 && (
                        <div className="text-center mt-5" style={{ color: 'var(--wa-input-bg)', padding: '10px', background: 'rgba(255,220,0,0.1)', borderRadius: '10px', margin: '0 auto', maxWidth: '300px' }}>
                            <small style={{color: 'var(--wa-text-secondary)'}}>
                                <i className="bi bi-lock-fill me-1"></i> Messages are end-to-end encrypted. No one outside of this chat, not even Randoman, can read or listen to them.
                            </small>
                        </div>
                    )}

                    {messages.map((msg) => {
                        const isOwn = msg.senderId === user._id;
                        return (
                            <div key={msg.id} className={`message-row ${isOwn ? 'row-own' : 'row-other'}`}>
                                <div className={`message-bubble ${isOwn ? 'bubble-own' : 'bubble-other'}`}>
                                    {!isOwn && collectionName !== 'direct_chats' && (
                                        <div className="sender-name">{msg.senderName}</div>
                                    )}

                                    {msg.type === 'image' ? (
                                        <a href={msg.fileUrl} target="_blank" rel="noreferrer">
                                            <img src={msg.fileUrl} alt="attachment" className="msg-image" />
                                        </a>
                                    ) : msg.type === 'file' ? (
                                        <a href={msg.fileUrl} target="_blank" rel="noreferrer" className="msg-file-card">
                                            <div className="file-icon-box"><i className="bi bi-file-earmark-text-fill"></i></div>
                                            <div className="file-info">
                                                <span className="file-name">{msg.fileName}</span>
                                                <span className="file-size">{formatBytes(msg.fileSize)}</span>
                                            </div>
                                            <i className="bi bi-download ms-2" style={{color: '#8696a0'}}></i>
                                        </a>
                                    ) : (
                                        <span>{msg.text}</span>
                                    )}

                                    <span className="msg-time">
                                        {formatTime(msg.timestamp)}
                                        {isOwn && <i className="bi bi-check2-all ms-1" style={{color: '#53bdeb', fontSize: '0.9rem'}}></i>}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                    <div ref={messagesEndRef} />
                </div>

                {/* Footer Input */}
                <div className="chat-footer">
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        style={{ display: 'none' }} 
                        onChange={handleFileUpload}
                    />

                    <button className="icon-btn" title="Attach" onClick={triggerFileInput} disabled={isUploading}>
                        {isUploading ? (
                            <span className="spinner-border spinner-border-sm" style={{color: 'var(--wa-text-secondary)'}}></span>
                        ) : (
                            <i className="bi bi-paperclip" style={{transform: 'rotate(45deg)'}}></i>
                        )}
                    </button>

                    <form onSubmit={handleSendMessage} style={{display: 'flex', flex: 1, alignItems: 'center', gap: '8px'}}>
                        <input 
                            type="text" 
                            className="chat-input-bar" 
                            placeholder="Type a message" 
                            value={newMessage}
                            onChange={handleTyping}
                        />
                        {newMessage.trim() ? (
                            <button type="submit" className="icon-btn btn-send">
                                <i className="bi bi-send-fill"></i>
                            </button>
                        ) : (
                            <button type="button" className="icon-btn">
                                <i className="bi bi-mic-fill"></i>
                            </button>
                        )}
                    </form>
                </div>
            </div>
        </div>
    );
};

export default Chat;