import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext'; // <-- 1. IMPORT THEME
import { Eye, EyeOff } from 'lucide-react';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import Navbar from './navbar';
import Footer from './Footer'; // <-- IMPORT FOOTER

function LoginForm() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const { setUser, user } = useAuth();
  const { theme } = useTheme(); // <-- 2. GET THEME

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
            --brand-primary: #4A69BD;
            --brand-dark: #1e272e;
            --brand-gradient: linear-gradient(135deg, #4A69BD 0%, #0c2461 100%);
            --text-muted: #636e72;
            --bg-subtle: #f1f2f6;
        }

        .auth-container {
            min-height: calc(100vh - 60px);
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: var(--bg-subtle);
            /* Subtle background pattern */
            background-image: radial-gradient(#dce4ed 1px, transparent 1px);
            background-size: 20px 20px;
            padding: 2rem 1rem;
        }

        .auth-card {
            border: none;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.1);
            overflow: hidden;
            background-color: #fff;
            min-height: 600px; /* Taller, more elegant card */
        }

        /* --- Left Column (Features) --- */
        .auth-welcome-col {
            background: var(--brand-gradient);
            padding: 4rem;
            color: white;
            position: relative;
            overflow: hidden;
        }
        
        /* Decorative circle overlay */
        .auth-welcome-col::before {
            content: '';
            position: absolute;
            top: -100px;
            right: -100px;
            width: 300px;
            height: 300px;
            background: rgba(255,255,255,0.1);
            border-radius: 50%;
        }

        .feature-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.5rem;
            margin-top: 2rem;
        }

        .feature-card {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 15px;
            padding: 1.5rem;
            transition: transform 0.3s ease;
            color: white;
        }
        .feature-card:hover {
            transform: translateY(-5px);
            background: rgba(255, 255, 255, 0.15);
        }

        .feature-icon {
            font-size: 1.8rem;
            margin-bottom: 0.5rem;
            color: #fff; /* White icons on dark bg */
        }

        /* --- Right Column (Form) --- */
        .auth-form-col {
            padding: 4rem;
            background-color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        /* Modern Inputs */
        .input-group-text {
            background: transparent;
            border-right: none;
            border-color: #dfe6e9;
            color: var(--text-muted);
        }
        .form-control {
            border-left: none;
            border-color: #dfe6e9;
            padding: 0.8rem 0.8rem 0.8rem 0;
            font-size: 1rem;
        }
        .form-control:focus {
            box-shadow: none;
            border-color: var(--brand-primary);
        }
        .input-group:focus-within .input-group-text {
            border-color: var(--brand-primary);
            color: var(--brand-primary);
        }
        
        .btn-primary {
            background: var(--brand-primary);
            border: none;
            padding: 0.8rem;
            border-radius: 10px;
            font-weight: 600;
            letter-spacing: 0.5px;
            transition: all 0.3s;
        }
        .btn-primary:hover {
            background: #3e5aa8;
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(74, 105, 189, 0.4);
        }

        .btn-outline-primary {
            color: var(--brand-primary);
            border-color: var(--brand-primary);
            border-radius: 50px;
            padding: 0.5rem 1.5rem;
        }
        
        .btn-outline-secondary {
             border-color: #dfe6e9;
        }
        .btn-outline-secondary:hover {
             background-color: #f1f2f6;
             color: var(--brand-dark);
             border-color: #b2bec3;
        }

        @media (max-width: 992px) {
            .auth-form-col { padding: 2rem; }
        }
      `}</style>

      <div className="auth-container">
        <div className="container">
          <div className="row justify-content-center">
            <div className="col-xl-11">
              <div className="card auth-card">
                <div className="row g-0 h-100">

                  {/* LEFT COLUMN: Professional Features Display */}
                  <div className="col-lg-6 d-none d-lg-flex flex-column justify-content-center auth-welcome-col">
                    <div style={{ position: 'relative', zIndex: 2 }}>
                      <h1 className="display-6 fw-bold mb-3">Connect with Confidence</h1>
                      <p className="mb-4" style={{ opacity: 0.9, fontSize: '1.1rem', fontWeight: 300 }}>
                        Experience the next generation of secure, high-fidelity audio and video communication designed for professionals.
                      </p>

                      <div className="feature-grid">
                        <div className="feature-card">
                          <div className="feature-icon"><i className="bi bi-shield-lock"></i></div>
                          <h6 className="fw-bold">End-to-End Secure</h6>
                          <small style={{ opacity: 0.8 }}>Private P2P connections</small>
                        </div>
                        <div className="feature-card">
                          <div className="feature-icon"><i className="bi bi-broadcast"></i></div>
                          <h6 className="fw-bold">Ultra-Low Latency</h6>
                          <small style={{ opacity: 0.8 }}>Real-time interaction</small>
                        </div>
                        <div className="feature-card">
                          <div className="feature-icon"><i className="bi bi-mic-fill"></i></div>
                          <h6 className="fw-bold">Crystal Audio</h6>
                          <small style={{ opacity: 0.8 }}>Noise suppression</small>
                        </div>
                        <div className="feature-card">
                          <div className="feature-icon"><i className="bi bi-hdd-network"></i></div>
                          <h6 className="fw-bold">Decentralized</h6>
                          <small style={{ opacity: 0.8 }}>No central servers</small>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* RIGHT COLUMN: Clean Login Form */}
                  <div className="col-lg-6 auth-form-col">
                    <div className="w-100" style={{ maxWidth: '380px' }}>
                      <form onSubmit={handleSubmit}>

                        <div className="text-center mb-5">
                          <div className="d-inline-block p-3 rounded-circle mb-3" style={{ background: '#f1f2f6' }}>
                            <i className="bi bi-person-fill" style={{ fontSize: '2.5rem', color: 'var(--brand-primary)' }}></i>
                          </div>
                          <h2 className="fw-bold" style={{ color: 'var(--brand-dark)' }}>Welcome Back</h2>
                          <p className="text-muted small">
                            Use your <strong>Randoman ID</strong> to access the network.
                          </p>
                        </div>

                        {error && (
                          <div className="alert alert-danger d-flex align-items-center p-2 mb-4" style={{ fontSize: '0.9rem' }}>
                            <i className="bi bi-exclamation-circle-fill me-2"></i>
                            {error}
                          </div>
                        )}

                        <div className="mb-4">
                          <label className="form-label small fw-bold text-uppercase text-muted">Email Address</label>
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
                          <label className="form-label small fw-bold text-uppercase text-muted">Password</label>
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
                              className="btn btn-outline-secondary"
                              style={{ borderLeft: 'none', borderRadius: '0 8px 8px 0' }}
                              onClick={() => setShowPassword(!showPassword)}
                              tabIndex={-1}
                            >
                              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                          </div>
                        </div>

                        <button
                          type="submit"
                          className="btn btn-primary w-100 mt-3 mb-4 shadow-sm"
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
                          <p className="text-muted mb-2 small">New to the network?</p>
                          <Link to="/register" className="btn btn-outline-primary btn-sm fw-bold">
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
      </div>
      <Footer />
    </>
  );
}

export default LoginForm;