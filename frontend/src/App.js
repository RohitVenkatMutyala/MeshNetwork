// frontend/src/App.js
import React from 'react';
import { Helmet } from 'react-helmet';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import LoginForm from './components/LoginForm';

import RegisterForm from './components/RegisterForm';
import { ThemeProvider } from './context/ThemeContext'; 
import Call from './components/call.js';
import CreateCall from './components/CreateCall'; // <-- 1. IMPORT CreateCall

function App() {
  return (
   <ThemeProvider>
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/" element={<>
              <Helmet>
                <title>Randoman</title>
              </Helmet>
              <LoginForm />
            </>} />
            <Route path="/login" element={<>
              <Helmet>
                <title>Login - Randoman</title>
              </Helmet>
              <LoginForm />
            </>} />
            <Route
              path="/register"
              element={
                <>
                  <Helmet><title>Register - Randoman</title></Helmet>
                  <RegisterForm />
                </>
              }
            />
         
            
            {/* --- 2. ADD THE NEW CreateCall ROUTE --- */}
            <Route 
              path="/new-call"
              element={
                <>
                  <Helmet><title>New Call - Randoman</title></Helmet>
                  <CreateCall />
                </>
              }
            />

            {/* --- 3. CORRECTED THE Call ROUTE (roomID -> callId) --- */}
            <Route 
              path="/call/:callId" 
              element={
                <>
                  <Helmet><title>Call - Randoman</title></Helmet>
                  <Call />
                </>
              } 
            />

          </Routes>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;