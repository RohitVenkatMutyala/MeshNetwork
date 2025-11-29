import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Eye, EyeOff } from 'lucide-react';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import Navbar from './navbar';
import Footer from './Footer';

function LoginForm() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const { setUser, user } = useAuth();
  const { theme } = useTheme();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const API_URL = process.env.REACT_APP_SERVER_API;

    try {
      const res = await axios.post(`${API_URL}/login`, form, {
        withCredentials: true,
      });

      setUser(res.data.user);
      navigate('/new-call');
    } catch (err) {
      setError('Login failed. Please check your credentials.');
      setLoading(false);
    }
  };

  if (user) {
    navigate("/new-call");
    return null;
  }

  return (
    <>
      <Navbar />
      
      <style>{`
        :root {
            /* --- THEME VARIABLES --- */
            --bg-page: #111b21; 
            --text-primary: #e9edef;
            --text-secondary: #8696a0;
            --input-bg: #202c33;
            --border-color: rgba(255, 255, 255, 0.1);
        }

        /* PAGE BACKGROUND */
        .auth-container {
            min-height: calc(100vh - 64px);
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: var(--bg-page);
            padding: 2rem 1rem;
        }

        /* --- MAIN GLASS CARD --- */
        .auth-card {
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 24px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
            overflow: hidden;
            background: rgba(31, 41, 55, 0.6); /* Dark Blue-Gray Glass */
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            min-height: 600px;
            display: flex;
            flex-direction: row;
        }

        /* --- LEFT COLUMN (Purple Glass Gradient) --- */
        .auth-welcome-col {
            background: linear-gradient(145deg, rgba(55, 65, 81, 0.6) 0%, rgba(17, 24, 39, 0.8) 100%);
            padding: 4rem;
            color: var(--text-primary);
            position: relative;
            overflow: hidden;
            border-right: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        /* Decorative Glow */
        .auth-welcome-col::before {
            content: '';
            position: absolute;
            top: -100px; right: -100px;
            width: 300px; height: 300px;
            background: rgba(111, 66, 193, 0.2); /* Purple Glow */
            filter: blur(60px);
            border-radius: 50%;
        }

        /* Feature Cards (Mini Glass) */
        .feature-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.5rem;
            margin-top: 3rem;
        }

        .feature-card {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px;
            padding: 1.5rem;
            transition: transform 0.3s ease;
            color: var(--text-primary);
        }
        .feature-card:hover {
            transform: translateY(-5px);
            background: rgba(255, 255, 255, 0.06);
            border-color: rgba(111, 66, 193, 0.5); /* Purple Highlight */
        }

        .feature-icon {
            font-size: 1.8rem;
            margin-bottom: 0.8rem;
            color: #b185f7; /* Light Purple */
        }

        /* --- RIGHT COLUMN (Form) --- */
        .auth-form-col {
            padding: 4rem;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
            flex: 1;
        }

        /* DARK MODE INPUTS */
        .form-label {
            color: var(--text-secondary);
            font-size: 0.8rem;
            letter-spacing: 0.5px;
        }

        .form-control {
            background-color: var(--input-bg) !important;
            color: var(--text-primary) !important;
            border: 1px solid var(--border-color);
            border-left: none;
            padding: 12px;
            font-size: 1rem;
        }
        .form-control:focus {
            box-shadow: none;
            border-color: #00a884; /* Green focus */
            background-color: #2a3942 !important;
        }
        .form-control::placeholder { color: #54656f !important; }

        .input-group-text {
            background-color: var(--input-bg) !important;
            border: 1px solid var(--border-color);
            border-right: none;
            color: var(--text-secondary) !important;
        }
        .input-group:focus-within .input-group-text {
            border-color: #00a884;
            color: #00a884 !important;
        }

        /* --- GLASSY BUTTONS --- */
        .btn-glass-primary {
            background: linear-gradient(135deg, rgba(0, 168, 132, 0.7), rgba(0, 143, 111, 0.9));
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: white;
            padding: 12px;
            border-radius: 24px;
            font-weight: 600;
            width: 100%;
            transition: all 0.3s ease;
            backdrop-filter: blur(4px);
        }
        .btn-glass-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(0, 168, 132, 0.3);
            color: white;
        }

        .btn-glass-outline {
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: var(--text-primary);
            background: transparent;
            border-radius: 24px;
            padding: 8px 20px;
            font-size: 0.9rem;
            transition: 0.3s;
        }
        .btn-glass-outline:hover {
            border-color: #00a884;
            color: #00a884;
            background: rgba(0, 168, 132, 0.1);
        }

        /* Eye Icon Button */
        .btn-eye {
            border-left: none;
            border-radius: 0 8px 8px 0;
            background-color: var(--input-bg) !important;
            border-color: var(--border-color);
        }
        .btn-eye:hover {
            background-color: #2a3942 !important;
        }

        @media (max-width: 992px) {
            .auth-card { flex-direction: column; }
            .auth-welcome-col { display: none !important; } /* Hide features on mobile for cleaner look */
            .auth-form-col { padding: 2rem; }
        }
      `}</style>

      <div className="auth-container">
        <div className="container">
          <div className="row justify-content-center">
            <div className="col-xl-11">
              
              <div className="auth-card">
                  
                  {/* LEFT COLUMN: FEATURES (Purple Glass) */}
                  <div className="col-lg-6 d-none d-lg-flex flex-column justify-content-center auth-welcome-col">
                    <div style={{ position: 'relative', zIndex: 2 }}>
                        <h1 className="display-6 fw-bold mb-3">Connect with Confidence</h1>
                        <p className="mb-4" style={{ opacity: 0.8, fontSize: '1.1rem', fontWeight: 300 }}>
                            Experience the next generation of secure, high-fidelity audio and video communication.
                        </p>

                        <div className="feature-grid">
                            <div className="feature-card">
                                <div className="feature-icon"><i className="bi bi-shield-lock"></i></div>
                                <h6 className="fw-bold">End-to-End Secure</h6>
                                <small style={{ opacity: 0.7 }}>Private P2P connections</small>
                            </div>
                            <div className="feature-card">
                                <div className="feature-icon"><i className="bi bi-broadcast"></i></div>
                                <h6 className="fw-bold">Ultra-Low Latency</h6>
                                <small style={{ opacity: 0.7 }}>Real-time interaction</small>
                            </div>
                            <div className="feature-card">
                                <div className="feature-icon"><i className="bi bi-mic-fill"></i></div>
                                <h6 className="fw-bold">Crystal Audio</h6>
                                <small style={{ opacity: 0.7 }}>Noise suppression</small>
                            </div>
                            <div className="feature-card">
                                <div className="feature-icon"><i className="bi bi-hdd-network"></i></div>
                                <h6 className="fw-bold">Decentralized</h6>
                                <small style={{ opacity: 0.7 }}>No central servers</small>
                            </div>
                        </div>
                    </div>
                  </div>

                  {/* RIGHT COLUMN: FORM (Dark Glass) */}
                  <div className="col-lg-6 auth-form-col">
                    <div className="w-100" style={{ maxWidth: '380px' }}>
                      <form onSubmit={handleSubmit}>
                        
                        <div className="text-center mb-5">
                          <div className="d-inline-flex p-3 rounded-circle mb-3" style={{ background: 'rgba(0, 168, 132, 0.1)', border: '1px solid rgba(0, 168, 132, 0.2)' }}>
                              <i className="bi bi-person-fill" style={{ fontSize: '2.5rem', color: '#00a884' }}></i>
                          </div>
                          <h2 className="fw-bold">Welcome Back</h2>
                          <p className="text-secondary small">
                            Use your <strong>Network ID</strong> to access the platform.
                          </p>
                        </div>

                        {error && (
                          <div className="alert alert-danger d-flex align-items-center p-2 mb-4" style={{fontSize: '0.9rem', background: 'rgba(220, 53, 69, 0.1)', border: '1px solid rgba(220, 53, 69, 0.2)', color: '#ef5350'}}>
                            <i className="bi bi-exclamation-circle-fill me-2"></i>
                            {error}
                          </div>
                        )}

                        <div className="mb-4">
                          <label className="form-label text-uppercase fw-bold">Email Address</label>
                          <div className="input-group">
                             <span className="input-group-text"><i className="bi bi-envelope"></i></span>
                            <input
                              type="email"
                              className="form-control"
                              placeholder="name@company.com"
                              value={form.email}
                              onChange={(e) => setForm({ ...form, email: e.target.value })}
                              required
                            />
                          </div>
                        </div>

                        <div className="mb-4">
                          <label className="form-label text-uppercase fw-bold">Password</label>
                          <div className="input-group">
                            <span className="input-group-text"><i className="bi bi-key"></i></span>
                            <input
                              type={showPassword ? 'text' : 'password'}
                              className="form-control"
                              placeholder="Enter your password"
                              value={form.password}
                              onChange={(e) => setForm({ ...form, password: e.target.value })}
                              required
                            />
                            <button
                              type="button"
                              className="btn btn-outline-secondary btn-eye"
                              onClick={() => setShowPassword(!showPassword)}
                              tabIndex={-1}
                            >
                              {showPassword ? <EyeOff size={18} color="#8696a0" /> : <Eye size={18} color="#8696a0" />}
                            </button>
                          </div>
                        </div>

                        <button
                          type="submit"
                          className="btn btn-glass-primary mt-3 mb-4"
                          disabled={loading}
                        >
                          {loading ? (
                            <>
                              <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                              Authenticating...
                            </>
                          ) : (
                            'Sign In to Dashboard'
                          )}
                        </button>

                        <div className="text-center">
                          <p className="text-secondary mb-2 small">New to the network?</p>
                          <Link to="/register" className="btn btn-glass-outline">
                            Create Account
                          </Link>
                        </div>

                      </form>
                    </div>
                  </div>

              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}

export default LoginForm;