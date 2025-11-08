// src/components/CreateCall.js

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import emailjs from '@emailjs/browser';
import RecentCalls from './RecentCalls';
import Navbar from './navbar';

function CreateCall() {
    const navigate = useNavigate();
    const { user } = useAuth();

    const [step, setStep] = useState(0); // 0 = Main list, 1 = Description, 2 = Invite
    const [description, setDescription] = useState('');
    const [recipientName, setRecipientName] = useState('');
    const [recipientEmail, setRecipientEmail] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    
    const [searchTerm, setSearchTerm] = useState('');

    const sendInvitationEmails = async (callId, callDescription, invitedEmails) => {
        if (!invitedEmails || invitedEmails.length === 0) return;
        
        const emailjsPublicKey = '3WEPhBvkjCwXVYBJ-';
        const serviceID = 'service_6ar5bgj';
        const templateID = 'template_w4ydq8a';
        
        const callLink = `${window.location.origin}/call/${callId}`; 
        
        for (const email of invitedEmails) {
            const templateParams = {
                from_name: `${user.firstname} ${user.lastname}`,
                to_email: email,
                session_description: callDescription,
                session_link: callLink,
            };
            try {
                await emailjs.send(serviceID, templateID, templateParams, emailjsPublicKey);
            } catch (error) {
                console.error(`Failed to send invitation to ${email}:`, error);
                toast.error(`Could not send invite to ${email}.`);
            }
        }
    };

    const handleCreateCall = async () => {
        if (!user) {
            toast.error("You must be logged in.");
            return;
        }
        if (!description) {
            toast.warn("A description is required.");
            return;
        }
        
        const recipientEmailClean = recipientEmail.trim();
        const recipientNameClean = recipientName.trim();

        if (!recipientNameClean) {
            toast.warn("Recipient's name is required.");
            return;
        }
        if (!recipientEmailClean) {
            toast.warn("Recipient's email is required.");
            return;
        }

        setIsLoading(true);

        const invitedEmails = [recipientEmailClean];
        const allowedEmails = [user.email, recipientEmailClean];
        
        const newCallId = Math.random().toString(36).substring(2, 9);
        const callDocRef = doc(db, 'calls', newCallId); 

        try {
            await setDoc(callDocRef, {
                description,
                createdAt: serverTimestamp(),
                ownerId: user._id,
                ownerName: `${user.firstname} ${user.lastname}`,
                ownerEmail: user.email, 
                recipientName: recipientNameClean,
                recipientEmail: recipientEmailClean, 
                access: 'private',
                defaultRole: 'editor',
                allowedEmails,
                permissions: { [user._id]: 'editor' },
                muteStatus: { [user._id]: false },
            });

            await sendInvitationEmails(newCallId, description, invitedEmails);
            toast.success("Call created and invitation sent!");
            
            navigate(`/call/${newCallId}`); 

        } catch (error) {
            console.error("Failed to create call:", error);
            toast.error("Could not create the call.");
        } finally {
            setIsLoading(false);
        }
    };

    const renderStep = () => {
        switch (step) {
            case 1: // Description Step
                return (
                    <div className="card-body p-4 p-md-5">
                        <h2 className="gradient-title">Call Description</h2>
                        <p className="text-muted mb-4">Give your call a clear and concise description.</p>
                        <textarea
                            className="form-control" rows="3"
                            placeholder="e.g., 'Project check-in'"
                            value={description} onChange={(e) => setDescription(e.target.value)}
                        />
                        <div className="d-flex justify-content-between mt-4">
                            <button className="btn btn-outline-secondary" onClick={() => setStep(0)}>Back to List</button>
                            <button className="btn create-btn" onClick={() => description ? setStep(2) : toast.warn('Description cannot be empty.')}>Next</button>
                        </div>
                    </div>
                );
            case 2: // Invite Step
                return (
                     <div className="card-body p-4 p-md-5">
                        <h2 className="gradient-title">Add New Contact</h2>
                        <p className="text-muted mb-4">Enter the details of the person you want to call.</p>
                        
                        <div className="form-floating mb-3">
                            <input
                                type="text"
                                className="form-control"
                                id="recipientName"
                                placeholder="Recipient's Name"
                                value={recipientName} 
                                onChange={(e) => setRecipientName(e.target.value)}
                            />
                            <label htmlFor="recipientName">Recipient's Name</label>
                        </div>
                        <div className="form-floating">
                            <input
                                type="email"
                                className="form-control"
                                id="recipientEmail"
                                placeholder="example@gmail.com"
                                value={recipientEmail} 
                                onChange={(e) => setRecipientEmail(e.target.value)}
                            />
                            <label htmlFor="recipientEmail">Recipient's Email</label>
                        </div>

                        <div className="d-flex justify-content-between mt-4">
                            <button className="btn btn-outline-secondary" onClick={() => setStep(1)}>Back</button>
                            <button className="btn create-btn" onClick={handleCreateCall} disabled={isLoading}>{isLoading ? 'Creating...' : 'Finish & Create Call'}</button>
                        </div>
                    </div>
                );
            default: // --- NEW: Main screen with Search and Add ---
                return (
                    <div className="card-body p-0 p-md-2">
                        <div className="p-3 p-md-4">
                            {/* --- UPDATED UI --- */}
                            <div className="d-flex gap-2 align-items-center">
                                {/* Small search bar */}
                                <div className="input-group input-group-sm flex-grow-1">
                                    <span className="input-group-text" id="search-icon"><i className="bi bi-search"></i></span>
                                    <input
                                        type="search"
                                        className="form-control" // form-control-sm is automatic in input-group-sm
                                        placeholder="Search recent calls..."
                                        aria-label="Search recent calls"
                                        aria-describedby="search-icon"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>
                                {/* Small icon button */}
                                <button 
                                    className="btn btn-primary btn-sm"
                                    onClick={() => setStep(1)}
                                    title="Add New Call"
                                    style={{lineHeight: 1}} // Fix for icon alignment
                                > 
                                    <i className="bi bi-person-plus-fill fs-6"></i>
                                </button>
                            </div>
                            {/* --- END UPDATED UI --- */}
                        </div>
                        {/* The RecentCalls component is now part of the default view */}
                        <RecentCalls searchTerm={searchTerm} />
                    </div>
                );
        }
    };

     if (!user) {
        return (
          <div className="container mt-5">
            <div className="alert alert-danger text-center">You are not logged in.</div>
          </div>
        );
     }

    return (
        <>
            <Navbar />
            <div className="container mt-5">
                <style jsx>{`
                    .calls-page-card { 
                        backdrop-filter: blur(15px); 
                        border: 1px solid var(--bs-border-color); 
                        transition: all 0.4s; 
                        overflow: hidden; 
                        background: var(--bs-body-bg);
                    }
                    .gradient-title { 
                        background: linear-gradient(90deg, #3b82f6, #8b5cf6, #ef4444); 
                        -webkit-background-clip: text; 
                        -webkit-text-fill-color: transparent; 
                        background-clip: text; 
                        font-weight: 700; 
                        font-size: 2rem; 
                        margin-bottom: 1.5rem; 
                    }
                    /* This is for the form steps, not the icon button */
                    .create-btn { 
                        background: linear-gradient(135deg, #f12711, #f5af19); 
                        border: none; 
                        color: white; 
                        font-weight: 600; 
                        transition: all 0.3s ease; 
                        box-shadow: 0 4px 15px rgba(241, 39, 17, 0.3);
                        padding: 0.75rem 1.5rem;
                    }
                    .create-btn:hover { 
                        transform: translateY(-2px); 
                        box-shadow: 0 8px 25px rgba(241, 39, 17, 0.4); 
                        color: white; 
                    }
                `}</style>
                <div className="card calls-page-card shadow-lg border-0 position-relative">
                    {renderStep()}
                </div>
            </div>
        </>
    );
}

export default CreateCall;