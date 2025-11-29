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
  const [hoveredFeature, setHoveredFeature] = useState(null); // <--- NEW: Track hovered card

  const navigate = useNavigate();
  const { setUser, user } = useAuth();
  const { theme } = useTheme();

  // --- NEW: Feature Data Configuration ---
  const features = [
    {
      id: 0,
      icon: 'bi-shield-lock',
      title: 'End-to-End Secure',
      short: 'Private P2P connections',
      detail: 'Achieved via WebRTC DTLS-SRTP protocols. Data flows directly between peers, encrypted with keys generated locally.'
    },
    {
      id: 1,
      icon: 'bi-broadcast',
      title: 'Ultra-Low Latency',
      short: 'Real-time interaction',
      detail: 'Achieved by eliminating central media servers. We establish direct mesh routes to ensure sub-100ms delivery.'
    },
    {
      id: 2,
      icon: 'bi-mic-fill',
      title: 'Crystal Audio',
      short: 'Noise suppression',
      detail: 'Achieved using the Opus codec with built-in AI noise suppression and echo cancellation algorithms running in-browser.'
    },
    {
      id: 3,
      icon: 'bi-hdd-network',
      title: 'Decentralized',
      short: 'No central servers',
      detail: 'Achieved by storing zero user media. Signaling is ephemeral, meaning your calls leave no trace on our infrastructure.'
    }
  ];

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
            --nav-bg: #202c33; 
            --nav-accent: #00a884;
            --nav-text: #e9edef;
            --brand-gradient: linear-gradient(135deg, #202c33 0%, #111b21 100%);
            --bg-subtle: #f0f2f5;
        }

        .auth-container {
            min-height: calc(100vh - 64px);
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: var(--bg-subtle);
            background-image: radial-gradient(#d1d7db 1px, transparent 1px);
            background-size: 20px 20px;
            padding: 2rem 1rem;
        }

        .auth-card {
            border: none;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.1);
            overflow: hidden;
            background-color: #fff;
            min-height: 600px;
        }

        /* --- Left Column (Features) --- */
        .auth-welcome-col {
            background: var(--brand-gradient);
            padding: 4rem;
            color: var(--nav-text);
            position: relative;
            overflow: hidden;
        }
        
        .auth-welcome-col::before {
            content: '';
            position: absolute;
            top: -100px;
            right: -100px;
            width: 300px;
            height: 300px;
            background: rgba(0, 168, 132, 0.1);
            border-radius: 50%;
        }

        .feature-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.5rem;
            margin-top: 2rem;
        }

        .feature-card {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 15px;
            padding: 1.5rem;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            color: #e9edef;
            cursor: default;
            position: relative;
            min-height: 160px; /* Ensure consistent height during hover */
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
        
        /* Hover Effect for Feature Card */
        .feature-card:hover {
            transform: translateY(-5px);
            background: rgba(255, 255, 255, 0.15);
            border-color: var(--nav-accent);
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
        }

        .feature-icon {
            font-size: 1.8rem;
            margin-bottom: 0.5rem;
            color: var(--nav-accent);
            transition: transform 0.3s ease;
        }
        
        .feature-card:hover .feature-icon {
            transform: scale(1.1);
        }

        .feature-desc {
            font-size: 0.9rem;
            opacity: 0.8;
            transition: opacity 0.2s ease;
        }
        
        .feature-detail {
            font-size: 0.85rem;
            line-height: 1.4;
            color: #fff;
            animation: fadeIn 0.3s ease-in-out;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(5px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* --- Right Column (Form) --- */
        .auth-form-col {
            padding: 4rem;
            background-color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .form-control {
            border-left: none;
            border-color: #e9edef;
            padding: 0.8rem 0.8rem 0.8rem 0;
            font-size: 1rem;
        }
        .form-control:focus {
            box-shadow: none;
            border-color: var(--nav-accent);
        }
        .input-group-text {
            background: transparent;
            border-right: none;
            border-color: #e9edef;
            color: #8696a0;
        }
        .input-group:focus-within .input-group-text {
            border-color: var(--nav-accent);
            color: var(--nav-accent);
        }
        
        .btn-primary {
            background: var(--nav-accent);
            border: none;
            padding: 0.8rem;
            border-radius: 24px;
            font-weight: 600;
            letter-spacing: 0.5px;
            transition: all 0.3s;
        }
        .btn-primary:hover {
            background: #008f6f;
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0, 168, 132, 0.3);
        }
        .btn-outline-primary {
            color: var(--nav-bg);
            border-color: var(--nav-bg);
            border-radius: 50px;
            padding: 0.5rem 1.5rem;
        }
        .btn-outline-primary:hover {
            background-color: var(--nav-bg);
            color: #fff;
        }
        .btn-outline-secondary { border-color: #e9edef; }

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
                        <p className="mb-4" style={{ opacity: 0.8, fontSize: '1.1rem', fontWeight: 300 }}>
                            Experience the next generation of secure, high-fidelity audio and video communication designed for professionals.
                        </p>

                        <div className="feature-grid">
                            {features.map((feature, index) => (
                                <div 
                                    key={feature.id} 
                                    className="feature-card"
                                    onMouseEnter={() => setHoveredFeature(index)}
                                    onMouseLeave={() => setHoveredFeature(null)}
                                >
                                    <div className="feature-icon">
                                        <i className={`bi ${feature.icon}`}></i>
                                    </div>
                                    <h6 className="fw-bold mb-1">{feature.title}</h6>
                                    
                                    {/* CONDITIONAL RENDERING BASED ON HOVER */}
                                    {hoveredFeature === index ? (
                                        <div className="feature-detail">
                                            {feature.detail}
                                        </div>
                                    ) : (
                                        <small className="feature-desc">{feature.short}</small>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                  </div>

                  {/* RIGHT COLUMN: Clean Login Form */}
                  <div className="col-lg-6 auth-form-col">
                    <div className="w-100" style={{ maxWidth: '380px' }}>
                      <form onSubmit={handleSubmit}>
                        
                        <div className="text-center mb-5">
                          <div className="d-inline-block p-3 rounded-circle mb-3" style={{ background: '#f0f2f5' }}>
                              <i className="bi bi-person-fill" style={{ fontSize: '2.5rem', color: 'var(--nav-bg)' }}></i>
                          </div>
                          <h2 className="fw-bold" style={{ color: 'var(--nav-bg)' }}>Welcome Back</h2>
                          <p className="text-muted small">
                            Use your <strong>Randoman ID</strong> to access the network.
                          </p>
                        </div>

                        {error && (
                          <div className="alert alert-danger d-flex align-items-center p-2 mb-4" style={{fontSize: '0.9rem'}}>
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