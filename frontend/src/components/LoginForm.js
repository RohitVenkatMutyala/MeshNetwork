import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff } from 'lucide-react';
import 'bootstrap/dist/css/bootstrap.min.css';


function LoginForm() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const { setUser,user } = useAuth();

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
 if(user){
  return(
    navigate("/new-call")
  )
 }
  return (
    <>
     
      <div 
        className="container-fluid min-vh-100 d-flex align-items-center justify-content-center text-light"
        style={{
          background: 'linear-gradient(135deg, #0d1117 0%, #1c1c1e 50%, #2c2c2e 100%)',
          backgroundAttachment: 'fixed'
        }}
      >
        <div className="container">
          <div className="row justify-content-center">
            
            {/* Left Column - Welcome Section */}
            <div className="col-lg-6 d-flex align-items-center mb-5 mb-lg-0">
              <div className="text-center text-lg-start">
                <h1 
                  className="display-4 fw-bold mb-4"
                  style={{
                    background: 'linear-gradient(135deg, #8e44ad, #3498db, #e74c3c)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  Welcome Back to CodeHub
                </h1>
              
                
                {/* Feature Highlights */}
                <div className="row g-3 mb-4">
                  <div className="col-6">
                    <div className="p-3 rounded-3 bg-secondary bg-opacity-10 border border-secondary border-opacity-25">
                      <div className="fs-4 mb-2">⚡</div>
                      <h6 className="fw-semibold text-light mb-1">Real-time</h6>
                      <small className="text-muted"> </small>
                    </div>
                  </div>
                  <div className="col-6">
                    <div className="p-3 rounded-3 bg-secondary bg-opacity-10 border border-secondary border-opacity-25">
                      <div className="fs-4 mb-2">💾</div>
                      <h6 className="fw-semibold text-light mb-1">Auto Save</h6>
                      <small className="text-muted"> </small>
                    </div>
                  </div>
                  <div className="col-6">
                    <div className="p-3 rounded-3 bg-secondary bg-opacity-10 border border-secondary border-opacity-25">
                      <div className="fs-4 mb-2">🤝</div>
                      <h6 className="fw-semibold text-light mb-1">Community</h6>
                      <small className="text-muted"> </small>
                    </div>
                  </div>
                  <div className="col-6">
                    <div className="p-3 rounded-3 bg-secondary bg-opacity-10 border border-secondary border-opacity-25">
                      <div className="fs-4 mb-2">🚀</div>
                      <h6 className="fw-semibold text-light mb-1">Fast</h6>
                      <small className="text-muted"> </small>
                    </div>
                  </div>
                </div>

            
              </div>
            </div>

            {/* Right Column - Login Form */}
            <div className="col-lg-6 d-flex justify-content-center">
              <div
                className="p-5 rounded-4 shadow-lg w-100 position-relative overflow-hidden"
                style={{
                  maxWidth: '500px',
                  background: 'rgba(28, 28, 30, 0.95)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)'
                }}
              >
                {/* Decorative Elements */}
                <div 
                  className="position-absolute"
                  style={{
                    top: '-50px',
                    right: '-50px',
                    width: '100px',
                    height: '100px',
                    background: 'linear-gradient(135deg, #8e44ad, #3498db)',
                    borderRadius: '50%',
                    opacity: '0.1',
                    filter: 'blur(40px)'
                  }}
                ></div>
                <div 
                  className="position-absolute"
                  style={{
                    bottom: '-30px',
                    left: '-30px',
                    width: '80px',
                    height: '80px',
                    background: 'linear-gradient(135deg, #f12711, #f5af19)',
                    borderRadius: '50%',
                    opacity: '0.1',
                    filter: 'blur(30px)'
                  }}
                ></div>

                <form onSubmit={handleSubmit} className="position-relative">
                  <div className="text-center mb-4">
                    <div 
                      className="d-inline-flex align-items-center justify-content-center rounded-circle mb-3"
                      style={{
                        width: '80px',
                        height: '80px',
                        background: 'linear-gradient(135deg, #8e44ad, #3498db)',
                        fontSize: '2.5rem'
                      }}
                    >
                      👨‍💻
                    </div>
                    <h2
                      className="fw-bold"
                      style={{
                        background: 'linear-gradient(135deg, #FFA000, #FFC107)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                      }}
                    >
                      LOGIN
                    </h2>
                   
                  </div>

                  {error && (
                    <div 
                      className="alert alert-danger rounded-3 border-0"
                      style={{
                        background: 'rgba(220, 53, 69, 0.1)',
                        borderLeft: '4px solid #dc3545'
                      }}
                    >
                      <i className="bi bi-exclamation-triangle-fill me-2"></i>
                      {error}
                    </div>
                  )}

                  <div className="mb-4">
                    <label className="form-label text-light fw-semibold">
                      <i className="bi bi-envelope-fill me-2"></i>
                      Email Address
                    </label>
                    <input
                      type="email"
                      className="form-control form-control-lg rounded-3"
                      placeholder="Enter your email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      required
                      style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        color: '#fff',
                        fontSize: '1rem',
                        transition: 'all 0.3s ease'
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = '#8e44ad';
                        e.currentTarget.style.boxShadow = '0 0 0 0.2rem rgba(142, 68, 173, 0.25)';
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    />
                  </div>

                  <div className="mb-4">
                    <label className="form-label text-light fw-semibold">
                      <i className="bi bi-lock-fill me-2"></i>
                      Password
                    </label>
                    <div className="input-group">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        className="form-control form-control-lg rounded-start-3"
                        placeholder="Enter your password"
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        required
                        style={{
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          borderRight: 'none',
                          color: '#fff',
                          fontSize: '1rem',
                          transition: 'all 0.3s ease'
                        }}
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = '#8e44ad';
                          e.currentTarget.style.boxShadow = '0 0 0 0.2rem rgba(142, 68, 173, 0.25)';
                          e.currentTarget.nextElementSibling.style.borderColor = '#8e44ad';
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                          e.currentTarget.style.boxShadow = 'none';
                          e.currentTarget.nextElementSibling.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-outline-secondary rounded-end-3"
                        onClick={() => setShowPassword(!showPassword)}
                        tabIndex={-1}
                        style={{
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          borderLeft: 'none',
                          color: '#fff',
                          transition: 'all 0.3s ease'
                        }}
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="btn btn-lg w-100 d-flex align-items-center justify-content-center rounded-3 fw-bold"
                    style={{
                      background: 'linear-gradient(135deg, #f12711, #f5af19)',
                      border: 'none',
                      color: 'white',
                      height: '55px',
                      transition: 'all 0.3s ease',
                      boxShadow: '0 4px 15px rgba(241, 39, 17, 0.3)'
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 8px 25px rgba(241, 39, 17, 0.4)';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 4px 15px rgba(241, 39, 17, 0.3)';
                    }}
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <span
                          className="spinner-border spinner-border-sm me-2"
                          role="status"
                          aria-hidden="true"
                        ></span>
                        Signing you in...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-box-arrow-in-right me-2"></i>
                        Sign In to Continue
                      </>
                    )}
                  </button>

                  <div className="text-center mt-4 pt-3 border-top border-secondary border-opacity-25">
                    <p className="text-muted mb-2">New to CodeHub?</p>
                    <button
                      type="button"
                      className="btn fw-bold"
                      onClick={() => navigate('/register')}
                      style={{
                        background: 'linear-gradient(135deg, #FF8F00, #FFCA28)',
                        color: 'white',
                        border: 'none',
                        padding: '8px 20px',
                        borderRadius: '8px',
                        transition: 'all 0.3s ease',
                        boxShadow: '0 2px 10px rgba(255, 143, 0, 0.3)'
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.style.transform = 'translateY(-1px)';
                        e.currentTarget.style.boxShadow = '0 4px 15px rgba(255, 143, 0, 0.4)';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 2px 10px rgba(255, 143, 0, 0.3)';
                      }}
                    >
                      <i className="bi bi-person-plus-fill me-2"></i>
                      Create Account
                    </button>
                    
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default LoginForm;