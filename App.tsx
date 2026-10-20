import React, { useState, useEffect } from 'react';
import ReminderApp from './components/ReminderApp';
import AuthAccessScreen from './components/AuthAccessScreen';
import { AuthUser } from './types';

const STORAGE_KEY_AUTH = 'voicereminder_auth_user_v1';

function App() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_AUTH);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Errore lettura utente autenticato:', e);
    }
    return null;
  });

  const handleLoginSuccess = (user: AuthUser) => {
    setCurrentUser(user);
    try {
      localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify(user));
    } catch (e) {
      console.warn('Errore salvataggio utente autenticato:', e);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    try {
      localStorage.removeItem(STORAGE_KEY_AUTH);
    } catch (e) {
      console.warn('Errore rimozione utente:', e);
    }
  };

  // If not yet authenticated, show the Access Gate Screen with Logo & Email/Gmail Code Verification
  if (!currentUser) {
    return (
      <AuthAccessScreen 
        onLoginSuccess={handleLoginSuccess}
        defaultEmail="lucquixada@gmail.com"
      />
    );
  }

  return (
    <div className="bg-black min-h-screen">
      <ReminderApp currentUser={currentUser} onLogout={handleLogout} />
    </div>
  );
}

export default App;
