// src/components/SharingComponent.js

import React, { useState } from 'react';
import { toast } from 'react-toastify'; // Using toast for user feedback

function SharingComponent() {
    // The state will manage the button's text for feedback
    const [copyButtonText, setCopyButtonText] = useState('Copy');
    
    // This gets the full URL of the current page
    const sessionUrl = window.location.href;

    // This function handles the copy-to-clipboard logic
    const handleCopyToClipboard = async () => {
        try {
            await navigator.clipboard.writeText(sessionUrl);
            setCopyButtonText('Copied!'); // Change button text
            toast.success("Session link copied to clipboard!"); // Show a success message

            // Reset the button text after 2 seconds
            setTimeout(() => {
                setCopyButtonText('Copy');
            }, 2000);
        } catch (err) {
            toast.error("Failed to copy the link.");
            console.error('Failed to copy link: ', err);
        }
    };

    return (
        <div className="card users-card shadow-lg mb-4">
            <div className="card-header users-header d-flex align-items-center">
                <i className="bi bi-share-fill me-2"></i>
                <h5 className="mb-0">Share Session</h5>
            </div>
            <div className="card-body">
            
                <div className="input-group">
                    <input
                        type="text"
                        className="form-control"
                        value={sessionUrl}
                        readOnly // Makes the input field not editable
                        aria-label="Session Link"
                    />
                    <button
                        className="btn btn-primary"
                        type="button"
                        onClick={handleCopyToClipboard}
                    >
                        <i className="bi bi-clipboard me-1"></i> {copyButtonText}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default SharingComponent;