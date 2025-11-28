import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebaseConfig';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';

// Props:
// chatId: The ID of the document (either the callId OR the unique email-combo ID)
// collectionName: 'calls' (for video chat) or 'direct_chats' (for home screen chat)
// recipientName: Name to display in header
// onClose: Function to close modal
const Chat = ({ chatId, collectionName = 'calls', recipientName, onClose }) => {
    const { user } = useAuth();
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const messagesEndRef = useRef(null);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Fetch Messages
    useEffect(() => {
        if (!chatId || !collectionName) return;

        // Dynamic path based on collectionName
        // If collectionName is 'direct_chats', path is: direct_chats/{chatId}/messages
        // If collectionName is 'calls', path is: calls/{chatId}/messages
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
            // toast.error("Could not load chat history."); 
        });

        return () => unsubscribe();
    }, [chatId, collectionName]);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim()) return;

        try {
            await addDoc(collection(db, collectionName, chatId, 'messages'), {
                text: newMessage,
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

    const formatTime = (timestamp) => {
        if (!timestamp) return '...';
        return timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    if (!user) {
         return (
            <div className="container mt-5">
               <div className="alert alert-danger text-center">You are not logged in.</div>
            </div>
         );
     }


    return (
        <div className="chat-modal-overlay" onClick={onClose}>
            <style jsx>{`
                .chat-modal-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(8px);
                    z-index: 1050; display: flex; align-items: center; justify-content: center;
                    animation: fadeIn 0.3s ease;
                }
                .chat-window {
                    width: 95%; max-width: 450px; height: 80vh;
                    background-color: #12121c; border-radius: 16px; border: 1px solid #3a3a5a;
                    display: flex; flex-direction: column; overflow: hidden;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.5);
                }
                .chat-header {
                    padding: 1rem; background-color: #1e1e2f; border-bottom: 1px solid #3a3a5a;
                    display: flex; align-items: center; justify-content: space-between; color: #e0e0e0;
                }
                .recipient-info { display: flex; align-items: center; gap: 10px; }
                .avatar-circle {
                    width: 40px; height: 40px; background: #4A69BD; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: bold; color: white;
                }
                .chat-body {
                    flex: 1; padding: 1rem; overflow-y: auto;
                    background-color: #0b0b10;
                    display: flex; flex-direction: column; gap: 0.5rem;
                }
                .message-bubble {
                    max-width: 75%; padding: 0.6rem 0.9rem; border-radius: 14px;
                    font-size: 0.95rem; line-height: 1.4; word-wrap: break-word; position: relative;
                }
                .msg-own {
                    align-self: flex-end; background-color: #4A69BD; color: white; border-bottom-right-radius: 2px;
                }
                .msg-other {
                    align-self: flex-start; background-color: #2b2b2b; color: #e0e0e0; border-bottom-left-radius: 2px;
                }
                .msg-time {
                    display: block; font-size: 0.65rem; margin-top: 4px; text-align: right; opacity: 0.7;
                }
                .chat-footer {
                    padding: 0.75rem; background-color: #1e1e2f; border-top: 1px solid #3a3a5a;
                }
                .chat-input-group {
                    display: flex; gap: 10px; background: #12121c; padding: 5px; border-radius: 25px; border: 1px solid #3a3a5a;
                }
                .chat-input {
                    flex: 1; background: transparent; border: none; color: white; padding: 8px 15px; outline: none;
                }
                .send-btn {
                    width: 40px; height: 40px; border-radius: 50%; border: none; background: #4A69BD; color: white;
                    display: flex; align-items: center; justify-content: center; transition: 0.2s;
                }
                .send-btn:hover { background: #3e5aa8; transform: scale(1.05); }
                .close-btn { background: transparent; border: none; color: #aaa; font-size: 1.2rem; }
                .close-btn:hover { color: white; }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            `}</style>

            <div className="chat-window" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="chat-header">
                    <div className="recipient-info">
                        <div className="avatar-circle">
                            {recipientName ? recipientName.charAt(0).toUpperCase() : '?'}
                        </div>
                        <div>
                            <h6 className="m-0 fw-bold">{recipientName || 'Unknown'}</h6>
                            {/* Visual indicator that this is a separate chat */}
                            <small className="text-info" style={{ fontSize: '0.7rem' }}>
                                {collectionName === 'direct_chats' ? 'Direct Message' : 'Call Chat'}
                            </small>
                        </div>
                    </div>
                    <button className="close-btn" onClick={onClose}>
                        <i className="bi bi-x-lg"></i>
                    </button>
                </div>

                {/* Body */}
                <div className="chat-body">
                    {messages.length === 0 && (
                        <div className="text-center text-muted mt-5">
                            <small>No messages yet. Start the conversation!</small>
                        </div>
                    )}
                    {messages.map((msg) => {
                        const isOwn = msg.senderId === user._id;
                        return (
                            <div key={msg.id} className={`message-bubble ${isOwn ? 'msg-own' : 'msg-other'}`}>
                                {msg.text}
                                <span className="msg-time">{formatTime(msg.timestamp)}</span>
                            </div>
                        );
                    })}
                    <div ref={messagesEndRef} />
                </div>

                {/* Footer */}
                <div className="chat-footer">
                    <form onSubmit={handleSendMessage} className="chat-input-group">
                        <input 
                            type="text" 
                            className="chat-input" 
                            placeholder="Type a message..." 
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                        />
                        <button type="submit" className="send-btn">
                            <i className="bi bi-send-fill"></i>
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default Chat;