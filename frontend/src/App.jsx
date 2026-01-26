import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, Loader2, PlusCircle, Settings, HelpCircle, X, Save, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';

function App() {
  const INITIAL_MESSAGE = {
    role: 'assistant',
    content: "Hi! I'm Abi. I can visualize spending, check budgets, and plan ahead. How can I help?"
  };

  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [settingsData, setSettingsData] = useState({
      openai_key: '',
      actual_url: '',
      actual_password: '',
      actual_sync_id: '',
      openai_model: 'gpt-4o-mini',
      openai_base_url: '',
      custom_model: ''
  });
  const [modalImage, setModalImage] = useState(null);
  const [configMissing, setConfigMissing] = useState(true); 
  const [isSyncing, setIsSyncing] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Check configuration on startup
  useEffect(() => {
    const checkConfig = () => {
      fetch('http://localhost:8000/settings')
        .then(res => res.json())
        .then(data => {
          // Must have OpenAI key and Actual credentials configured
          const isMissing = !data.has_openai || !data.has_password || !data.actual_sync_id;
          setConfigMissing(isMissing);
        })
        .catch(() => {
          setConfigMissing(true); 
        });
    };
    checkConfig();
  }, []);

  useEffect(() => {
    if (showSettings) {
      fetch('http://localhost:8000/settings')
        .then(res => res.json())
        .then(data => {
            const standardModels = ['gpt-4o-mini', 'gpt-4o', 'o4-mini'];
            const isCustom = !standardModels.includes(data.openai_model);
            
            setSettingsData({
                openai_key: data.has_openai ? '******' : '',
                actual_url: data.actual_url,
                actual_password: data.has_password ? '******' : '',
                actual_sync_id: data.actual_sync_id,
                openai_model: isCustom ? 'custom' : data.openai_model,
                openai_base_url: data.openai_base_url,
                custom_model: isCustom ? data.openai_model : ''
            });
        })
        .catch(err => console.error("Failed to fetch settings", err));
    }
  }, [showSettings]);

  const saveSettings = async () => {
      const payload = {};
      if (settingsData.openai_key && settingsData.openai_key !== '******') payload.openai_key = settingsData.openai_key;
      if (settingsData.actual_url) payload.actual_url = settingsData.actual_url;
      if (settingsData.actual_password && settingsData.actual_password !== '******') payload.actual_password = settingsData.actual_password;
      if (settingsData.actual_sync_id) payload.actual_sync_id = settingsData.actual_sync_id;
      
      // Determine model to save
      let finalModel = settingsData.openai_model;
      if (settingsData.openai_model === 'custom') {
          finalModel = settingsData.custom_model;
      }
      payload.openai_model = finalModel;

      payload.openai_base_url = settingsData.openai_base_url;
      
      try {
        await fetch('http://localhost:8000/settings', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        setShowSettings(false);
        // Re-check config after saving
        setConfigMissing(false);
      } catch (err) {
        alert("Failed to save settings");
      }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleNewChat = () => {
    setMessages([INITIAL_MESSAGE]);
    setInput('');
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const historyPayload = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role,
        content: m.content
      }));

      const response = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          history: historyPayload,
          message: userMsg.content,
        }),
      });

      if (!response.ok) throw new Error('API Error');

      const data = await response.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: "Sorry, I couldn't reach the backend server." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderMessageContent = (text) => {
    // 1. Extract Base64 Images
    const imageRegex = /!\[(.*?)\]\((data:image\/png;base64,[^)]+)\)/g;
    const images = [];
    let match;
    // Clone regex logic to iterate finding all matches
    while ((match = imageRegex.exec(text)) !== null) {
      images.push({ alt: match[1], src: match[2] });
    }

    // 2. Remove Image Markdown from text to hide it
    const cleanText = text.replace(imageRegex, '').trim();

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: '15px', lineHeight: '1.6' }}>{cleanText}</div>

        {images.map((img, idx) => (
          <div key={idx} style={{ 
            marginTop: '10px',
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e5e5ea', 
            overflow: 'hidden'
          }}>
            <img 
              src={img.src} 
              alt={img.alt} 
              onClick={() => setModalImage(img.src)}
              style={{ 
                maxWidth: '100%', 
                display: 'block',
                cursor: 'pointer',
                transition: 'opacity 0.2s',
              }}
              onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
              onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100vh', 
      width: '100vw',
      backgroundColor: '#f5f5f7', 
      color: '#1d1d1f', 
      fontFamily: "'Segoe UI', Roboto, sans-serif",
      overflow: 'hidden',
      boxSizing: 'border-box' 
    }}>
      
      {/* Header */}
      <div style={{ padding: '15px 20px', backgroundColor: '#6200ea', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ backgroundColor: 'white', borderRadius: '50%', padding: '6px', display: 'flex' }}>
            <Bot size={22} color="#6200ea" />
          </div>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'white' }}>Abi Assistant</h2>
        </div>
        
        <div style={{ display: 'flex', gap: '10px' }}>
           <button onClick={() => setShowHelp(true)} title="Help" style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white' }}>
             <HelpCircle size={20} />
           </button>
           <button onClick={() => setShowSettings(true)} title="Settings" style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white' }}>
             <Settings size={20} />
           </button>
           <button onClick={handleNewChat} title="Start New Chat" style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white' }}>
             <PlusCircle size={20} />
           </button>
        </div>
      </div>

      {/* Messages */}
      <div style={{ 
        flex: 1, 
        overflowY: 'auto', 
        padding: '24px', 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '16px',
        maxWidth: '1200px',
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box'
      }}>
        {messages.map((msg, i) => {
          const hasGraph = msg.content.includes('![');
          return (
          <div key={i} style={{ 
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: hasGraph ? '100%' : '75%',
            width: hasGraph ? '100%' : 'auto',
            backgroundColor: msg.role === 'user' ? '#6200ea' : '#ffffff',
            color: msg.role === 'user' ? 'white' : '#1d1d1f',
            padding: '14px 18px',
            borderRadius: '16px',
            borderTopLeftRadius: msg.role === 'assistant' ? '4px' : '16px',
            borderTopRightRadius: msg.role === 'user' ? '4px' : '16px',
            lineHeight: '1.6',
            fontSize: '15px',
            boxShadow: msg.role === 'user' ? '0 2px 8px rgba(98,0,234,0.15)' : '0 2px 8px rgba(0,0,0,0.08)',
            whiteSpace: 'pre-wrap',
            border: msg.role === 'assistant' ? '1px solid #e5e5ea' : 'none',
            boxSizing: 'border-box'
          }}>
            {renderMessageContent(msg.content)}
          </div>
        );
        })}
        
        {isLoading && (
          <div style={{ alignSelf: 'flex-start', color: '#8e8e93', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', marginLeft: '5px' }}>
            <Loader2 size={16} className="spin" /> Abi is thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Config Warning Banner */}
      {configMissing && (
        <div style={{
          padding: '12px 20px',
          backgroundColor: '#fff3cd',
          borderTop: '1px solid #ffc107',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          justifyContent: 'center'
        }}>
          <AlertTriangle size={18} color="#856404" />
          <span style={{ color: '#856404', fontSize: '14px' }}>
            Please configure your API keys in <button 
              onClick={() => setShowSettings(true)} 
              style={{ 
                background: 'none', 
                border: 'none', 
                color: '#6200ea', 
                textDecoration: 'underline', 
                cursor: 'pointer',
                fontSize: '14px',
                padding: 0
              }}
            >Settings</button> to get started.
          </span>
        </div>
      )}

      {/* Input */}
      <div style={{ 
        padding: '20px 24px', 
        borderTop: '1px solid #e5e5ea', 
        backgroundColor: '#ffffff', 
        display: 'flex', 
        gap: '12px',
        maxWidth: '1200px',
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box'
      }}>
        <input 
          type="text" 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={configMissing ? undefined : handleKeyDown}
          disabled={configMissing}
          placeholder={configMissing ? "Configure settings to start..." : "Ask about your spending..."}
          style={{
            flex: 1,
            padding: '12px 15px',
            borderRadius: '24px',
            border: '1px solid #d1d1d6',
            backgroundColor: configMissing ? '#e5e5ea' : '#f2f2f7',
            color: '#1d1d1f',
            outline: 'none',
            fontSize: '15px'
          }}
        />
        <button 
          onClick={handleSend}
          disabled={isLoading || !input.trim() || configMissing}
          style={{
            width: '46px',
            height: '46px',
            borderRadius: '50%',
            border: 'none',
            color: '#6200ea',
            cursor: configMissing ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0, 
            opacity: isLoading || !input.trim() || configMissing ? 0.6 : 1,
            transition: 'opacity 0.2s',
            flexShrink: 0
          }}
        >
          <Send size={20} style={{ marginLeft: '-2px' }} /> 
        </button>
      </div>

      {/* Image Modal */}
      {modalImage && (
        <div 
          onClick={() => setModalImage(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}
        >
          <img 
            src={modalImage} 
            alt="Full size chart" 
            style={{ 
              maxWidth: '90%', 
              maxHeight: '90%',
              objectFit: 'contain',
              borderRadius: '12px', 
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
            }} 
            onClick={(e) => e.stopPropagation()} 
          />
          <button
            onClick={() => setModalImage(null)}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'white',
              border: 'none',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              fontSize: '20px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>
      )}
      
      {/* Help Modal */}
      {showHelp && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div style={{ backgroundColor: 'white', padding: '30px', borderRadius: '16px', maxWidth: '500px', width: '90%', position: 'relative', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
            <button onClick={() => setShowHelp(false)} style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', cursor: 'pointer', color: '#8e8e93' }}><X size={24}/></button>
            <h2 style={{ marginTop: 0, color: '#6200ea' }}>Getting Started</h2>
            <p><strong>1. Get Actual Budget:</strong> This assistant works with <a href="https://actualbudget.com" target="_blank" rel="noreferrer" style={{color: '#6200ea'}}>Actual Budget</a>. You need a running server (local or cloud).</p>
            <p><strong>2. Connect Bridge:</strong></p>
            <ul style={{ lineHeight: '1.6', paddingLeft: '20px' }}>
                <li>Go to <strong>Settings</strong> in Actual Budget.</li>
                <li>Click <strong>Show Advanced Settings</strong>.</li>
                <li>Copy your <strong>Sync ID</strong>.</li>
                <li>Ensure you have your <strong>Server URL</strong> and <strong>Password</strong>.</li>
            </ul>
            <p><strong>3. Configure:</strong> Click the Settings icon <Settings size={14} style={{display:'inline'}}/> in the header and enter your details to connect.</p>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
           <div style={{ backgroundColor: 'white', padding: '30px', borderRadius: '16px', maxWidth: '500px', width: '90%', maxHeight: '85vh', overflowY: 'auto', position: 'relative', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
            <button onClick={() => setShowSettings(false)} style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', cursor: 'pointer', color: '#8e8e93' }}><X size={24}/></button>
            <h2 style={{ marginTop: 0, color: '#6200ea' }}>Settings</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div>
                   <label style={{ display: 'block', marginBottom: '5px', fontWeight: 500 }}>OpenAI API Key</label>
                   <input type="password" value={settingsData.openai_key} onChange={e => { const val = e.target.value; setSettingsData(prev => ({...prev, openai_key: (prev.openai_key === '******' && val.length < 6) ? '' : val })); }} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #d1d1d6', boxSizing: 'border-box' }} placeholder="sk-..." />
                </div>
                
                {/* Model Selector */}
                <div>
                   <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>AI Model</label>
                   <select 
                      value={settingsData.openai_model} 
                      onChange={(e) => setSettingsData({...settingsData, openai_model: e.target.value})}
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #d1d1d6', backgroundColor: 'white', boxSizing: 'border-box', fontSize: '15px' }}
                   >
                       <option value="gpt-4o-mini">GPT-4o Mini (Fast & Cost-Effective)</option>
                       <option value="gpt-4o">GPT-4o (High Intelligence)</option>
                       <option value="o4-mini">o4-mini (Reasoning)</option>
                       <option value="custom">Custom (See Advanced)</option>
                   </select>
                </div>

                <div>
                   <label style={{ display: 'block', marginBottom: '5px', fontWeight: 500 }}>Actual Server URL</label>
                   <input type="text" value={settingsData.actual_url} onChange={e => setSettingsData({...settingsData, actual_url: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #d1d1d6', boxSizing: 'border-box' }} placeholder="http://localhost:5006" />
                </div>
                <div>
                   <label style={{ display: 'block', marginBottom: '5px', fontWeight: 500 }}>Actual Password</label>
                   <input type="password" value={settingsData.actual_password} onChange={e => { const val = e.target.value; setSettingsData(prev => ({...prev, actual_password: (prev.actual_password === '******' && val.length < 6) ? '' : val })); }} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #d1d1d6', boxSizing: 'border-box' }} />
                </div>
                <div>
                   <label style={{ display: 'block', marginBottom: '5px', fontWeight: 500 }}>Sync ID</label>
                   <input type="text" value={settingsData.actual_sync_id} onChange={e => setSettingsData({...settingsData, actual_sync_id: e.target.value})} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #d1d1d6', boxSizing: 'border-box' }} />
                </div>

                {/* Advanced Settings */}
                <div style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '20px' }}>
                    <div 
                        onClick={() => setSettingsData(prev => ({ ...prev, showAdvanced: !prev.showAdvanced }))}
                        style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none', color: '#666' }}
                    >
                        <span style={{ marginRight: '8px', fontSize: '12px' }}>{settingsData.showAdvanced ? '▼' : '▶'}</span>
                        <span style={{ fontWeight: 600 }}>Advanced Settings</span>
                    </div>

                    {settingsData.showAdvanced && (
                        <div style={{ marginTop: '15px', paddingLeft: '10px', borderLeft: '2px solid #eee' }}>
                           <div style={{ backgroundColor: '#fff3cd', color: '#856404', padding: '10px', borderRadius: '6px', fontSize: '12px', marginBottom: '15px' }}>
                               ⚠ Warning: Changing these settings might break the application if configured incorrectly. Errors may arise from incompatible LLM outputs.
                           </div>

                           <div style={{ marginBottom: '15px' }}>
                               <label style={{ display: 'block', marginBottom: '5px', fontWeight: 500, fontSize: '13px' }}>Custom OpenAI Base URL</label>
                               <input 
                                   type="text" 
                                   value={settingsData.openai_base_url || ''} 
                                   onChange={e => setSettingsData({...settingsData, openai_base_url: e.target.value})} 
                                   placeholder="https://api.openai.com/v1"
                                   style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #d1d1d6', boxSizing: 'border-box', fontSize: '13px' }} 
                               />
                               <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>Leave empty for default OpenAI behavior.</div>
                           </div>
                           
                           <div style={{ marginBottom: '15px' }}>
                               <label style={{ display: 'block', marginBottom: '5px', fontWeight: 500, fontSize: '13px' }}>Custom Model Name</label>
                               <input 
                                   type="text" 
                                   value={settingsData.custom_model || ''} 
                                   onChange={e => setSettingsData({...settingsData, custom_model: e.target.value})} 
                                   placeholder="e.g. llama-3.2-locally"
                                   style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #d1d1d6', boxSizing: 'border-box', fontSize: '13px' }} 
                               />
                               <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>
                                   If set, this overrides the radio selection above.
                               </div>
                           </div>
                        </div>
                    )}
                </div>

                <button onClick={saveSettings} style={{ marginTop: '10px', backgroundColor: '#6200ea', color: 'white', border: 'none', padding: '12px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '15px' }}>
                    Save Settings
                </button>
                
                {/* Sync Button */}
                <button 
                    disabled={isSyncing}
                    onClick={async () => {
                        setIsSyncing(true);
                        try {
                            const res = await fetch('http://localhost:8000/sync', { method: 'POST' });
                            if (res.ok) {
                                alert('Data synced successfully!');
                            } else {
                                const err = await res.text();
                                alert('Sync failed: ' + (err || 'Check your Actual Budget credentials.'));
                            }
                        } catch (e) {
                            alert('Could not connect to backend for sync.');
                        } finally {
                            setIsSyncing(false);
                        }
                    }}
                    style={{ marginTop: '10px', backgroundColor: isSyncing ? '#81C784' : '#4CAF50', color: 'white', border: 'none', padding: '12px', borderRadius: '8px', cursor: isSyncing ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '15px', opacity: isSyncing ? 0.7 : 1 }}
                >
                    {isSyncing ? <Loader2 size={18} className="spin" /> : ''} {isSyncing ? 'Syncing...' : 'Sync Actual Budget Data'}
                </button>
            </div>
          </div>
        </div>
      )}
      
      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        
        /* Custom scrollbar */
        ::-webkit-scrollbar { width: 10px; }
        ::-webkit-scrollbar-track { background: #f5f5f7; }
        ::-webkit-scrollbar-thumb { 
          background: #c1c1c4; 
          border-radius: 5px;
          border: 2px solid #f5f5f7;
        }
        ::-webkit-scrollbar-thumb:hover { background: #a1a1a4; }
        
        /* Responsive adjustments */
        @media (max-width: 768px) {
          [style*="minWidth: 500px"] {
            min-width: 280px !important;
            max-width: 95% !important;
          }
        }
      `}</style>
    </div>
  )
}

export default App
