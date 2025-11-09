import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
// import emailjs from '@emailjs/browser'; // --- NO LONGER NEEDED HERE ---
import RecentCalls from './RecentCalls';
import Navbar from './navbar';

function CreateCall() {
    const navigate = useNavigate(); // Still needed if you have other navigation
    const { user } = useAuth();

    const [step, setStep] = useState(0); // 0 = Main list, 1 = Description, 2 = Invite
    const [description, setDescription] = useState('');
    const [recipientName, setRecipientName] = useState('');
    const [recipientEmail, setRecipientEmail] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    
    const [searchTerm, setSearchTerm] = useState('');

    /* // --- REMOVED ---
    // This function is no longer called from this component.
    // It is now only called by handleReCall in RecentCalls.js
    const sendInvitationEmails = async (callId, callDescription, invitedEmails) => {
    // ...
    };
    */

    // --- MODIFIED FUNCTION ---
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

        // const invitedEmails = [recipientEmailClean]; // --- NO LONGER NEEDED ---
        const allowedEmails = [user.email, recipientEmailClean];
        
        const newCallId = Math.random().toString(36).substring(2, 9);
        const callDocRef = doc(db, 'calls', newCallId); 

        try {
            // This part is still needed! It creates the call document
            // so that RecentCalls can find it.
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

            // --- REMOVED ---
            // await sendInvitationEmails(newCallId, description, invitedEmails);
            
            // --- MODIFIED ---
            toast.success("Contact added to recent calls!");
            
            // --- REMOVED ---
            // navigate(`/call/${newCallId}`); 

            // --- NEW: Reset form and go back to the list
            setDescription('');
            setRecipientName('');
            setRecipientEmail('');
            setStep(0);

        } catch (error) {
            console.error("Failed to create call:", error);
            toast.error("Could not save the contact.");
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
                            {/* --- MODIFIED BUTTON TEXT --- */}
                            <button className="btn create-btn" onClick={handleCreateCall} disabled={isLoading}>
                                {isLoading ? 'Saving...' : 'Save Contact'}
                            </button>
                        </div>
                    </div>
                );
            default: // --- Main screen with Search and Add ---
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
                                        className="form-control"
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
                    
                    /* --- MODIFIED: Removed gradient --- */
                    .gradient-title { 
                        color: var(--bs-body-color); /* Use theme text color */
                        font-weight: 700; 
                        font-size: 2rem; 
                        margin-bottom: 1.5rem; 
                    }
                    
                    /* --- MODIFIED: Replaced gradient with solid color --- */
                    .create-btn { 
                        background-color: #4A69BD; /* Professional blue */
                        border: 1px solid #4A69BD;
                        color: white; 
                        font-weight: 600; 
                        transition: all 0.2s ease; 
                        box-shadow: 0 4px 12px rgba(74, 105, 189, 0.25);
                        padding: 0.75rem 1.5rem;
                    }
                    .create-btn:hover { 
                        background-color: #3e5aa8; /* Darker blue */
                        border-color: #3e5aa8;
                        box-shadow: 0 6px 16px rgba(74, 105, 189, 0.3); 
                        color: white; 
                        transform: translateY(-1px);
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