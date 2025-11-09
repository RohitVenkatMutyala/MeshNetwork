import React from 'react';
import { useTheme } from '../context/ThemeContext';

function Footer() {
    const { theme } = useTheme();

    return (
        <>
            <style>{`
                .footer-container {
                    padding: 2rem 1rem;
                    background-color: var(--bs-tertiary-bg);
                    border-top: 1px solid var(--bs-border-color);
                }
                .footer-text {
                    font-size: 0.9rem;
                    color: var(--bs-secondary-color);
                    margin: 0;
                }
                .footer-text strong {
                    font-weight: 600;
                    color: var(--bs-body-color);
                }
            `}</style>
            <footer className="footer-container" data-bs-theme={theme}>
                <div className="container text-center">
                    <p className="footer-text">
                        A Product of <strong>Randoman</strong>
                    </p>
                </div>
            </footer>
        </>
    );
}

export default Footer;