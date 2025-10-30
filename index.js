const express = require('express');
const cors = require('cors');
const twilio = require('twilio');
const { Server } = require('socket.io');
const http = require('http');
require('dotenv').config();
const VoiceResponse = twilio.twiml.VoiceResponse;
const leadRoutes = require('./routes/leadRoutes');
const authRoutes = require('./routes/authRoutes');
const callHistoryRoutes = require('./routes/callHistoryRoutes');
const connectDB = require('./config/database');
connectDB()
const app = express();
const server = http.createServer(app);
console.log

// Helper to ensure BASE_URL doesn't have trailing slash
const BASE_URL = process.env.BASE_URL?.replace(/\/+$/, '') || '';

// WebSocket Server Configuration
const io = new Server(server, {
  cors: {
    origin: [
      'https://zolara-dialer-frontend.vercel.app',
      'http://localhost:3000',
      'https://zolara-dialer.vercel.app',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// Database Connection


// CORS Configuration
const allowedOrigins = [
  'https://zolara-dialer-frontend.vercel.app',
  'http://localhost:3000',
  'https://zolara-dialer.vercel.app',
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  })
);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Handle preflight requests
app.options('*', cors());

// Store active calls and agent statuse
const activeCalls = new Map();
const agentStatuses = new Map();

// Twilio Client Initialization
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// WebSocket Connection Handling
io.on('connection', (socket) => {
  console.log('\n === AGENT CONNECTED ===');
  console.log('SocketId:', socket.id);
  agentStatuses.set(socket.id, 'available');
  console.log('Current agents:', Array.from(agentStatuses.entries()));
  
  socket.on('disconnect', () => {
    console.log('\n === AGENT DISCONNECTED ===');
    console.log('SocketId:', socket.id);
    agentStatuses.delete(socket.id);
    console.log('Remaining agents:', Array.from(agentStatuses.entries()));
  });
  
  // Handle agent status updates
  socket.on('updateAgentStatus', (status) => {
    console.log('Agent status update:', socket.id, status);
    agentStatuses.set(socket.id, status);
    socket.broadcast.emit('agentStatusUpdated', { agentId: socket.id, status });
  });
});

// Helper Function to Broadcast Call Status
const broadcastCallStatus = (data) => {
  io.emit('callStatusUpdated', data);
};

app.use('/api/leads', leadRoutes);
app.use('/api/call-history', callHistoryRoutes);
app.use('/api/auth', authRoutes);
// API to get ICE servers (STUN/TURN)
app.get('/api/turn-credentials', async (req, res) => {
  try {
    const iceServers = await twilioClient.tokens.create();
    res.json(iceServers);
    console.log('Fetched TURN credentials:', iceServers);
  } catch (error) {
    console.error('Error fetching TURN credentials:', error);
    res.status(500).json({ error: 'Failed to fetch TURN credentials' });
  }
});
// Generate Twilio WebRTC Token
app.get('/api/token', (req, res) => {
  try {
    const identity = `agent-${Math.random().toString(36).substring(7)}`;
    console.log(' Generating token for identity:', identity);

    const accessToken = new twilio.jwt.AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY,
      process.env.TWILIO_API_SECRET,
      { identity: identity, ttl: 3600 }
    );

    console.log(' Using Twilio credentials:'
    );

    const voiceGrant = new twilio.jwt.AccessToken.VoiceGrant({
      outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID,
      incomingAllow: true
    });

    accessToken.addGrant(voiceGrant);
    const token = accessToken.toJwt();

    console.log(' Token generated successfully');
    res.json({ token });
  } catch (error) {
    console.error(' Error generating token:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/calls/initiate', async (req, res) => {
  const { from, to, userId } = req.body;

  if (!to) {
    console.error("❌ ERROR: 'To' number is missing in the request.");
    return res.status(400).json({ success: false, message: "Missing 'to' number" });
  }

  console.log(`🚀 Initiating DIRECT call to ${to} from ${from}`);

  try {
    const formattedNumber = to.startsWith('+') ? to : `+${to}`;

    // Store call initiation info (before the call is created)
    const callData = { 
      to: formattedNumber, 
      status: 'initiating', 
      userId: userId,
      from: from,
      timestamp: new Date().toISOString()
    };

    console.log(`✅ Call will be created by device.connect() on frontend`);

    res.json({ 
      success: true,
      to: formattedNumber,
      from: from
    });
  } catch (error) {
    console.error('❌ Error initiating call:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Customer joins conference (called when customer answers)
app.post('/api/twiml/customer', async (req, res) => {
  const conferenceName = req.query.conferenceName || req.body.conferenceName;
  
  console.log('👤 Customer TwiML request:', { conferenceName, body: req.body });

  const twiml = new VoiceResponse();
  
  if (!conferenceName) {
    twiml.say('Conference not found.');
    twiml.hangup();
  } else {
    // Customer joins conference and waits for agent
    const dial = twiml.dial();
    dial.conference({
      startConferenceOnEnter: false,  // Don't start until agent joins
      endConferenceOnExit: true,      // End conference when customer leaves
      beep: false,
      waitUrl: "http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical",
      statusCallbackEvent: ["start", "end", "join", "leave"],
      statusCallback: `${BASE_URL}/conference-status`,
      statusCallbackMethod: "POST",
      maxParticipants: 2
    }, conferenceName);
  }

  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

// Agent joins conference (called when agent's browser receives call)
app.post('/api/twiml/agent', async (req, res) => {
  const conferenceName = req.query.conferenceName || req.body.conferenceName;
  
  console.log('🎧 Agent TwiML request:', { conferenceName, body: req.body });

  const twiml = new VoiceResponse();
  
  if (!conferenceName) {
    twiml.say('Conference not found.');
    twiml.hangup();
  } else {
    // Agent joins the same conference as customer
    const dial = twiml.dial();
    dial.conference({
      startConferenceOnEnter: true,   // Agent starts the conference
      endConferenceOnExit: false,     // Conference continues if agent leaves
      beep: false,
      statusCallbackEvent: ["start", "end", "join", "leave"],
      statusCallback: `${BASE_URL}/conference-status`,
      statusCallbackMethod: "POST",
      maxParticipants: 2
    }, conferenceName);
  }

  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});


app.post('/api/calls/status', async (req, res) => {
  const callSid = req.body.CallSid || req.body.callSid;
  const callStatus = req.body.CallStatus;

  console.log('\n === CALL STATUS UPDATE ===');
  console.log(' Call Details:',
      '\n - CallSid:', callSid,
      '\n - CallStatus:', callStatus,
      '\n - CallDuration:', req.body.CallDuration
  );
  console.log(req.body);

  try {
      // Get the call data and user ID
      const callData = activeCalls.get(callSid);
      const userId = callData.userId;

      if (userId) {
          // Create call history data
          const callHistoryData = {
              callId: callSid,
              status: callStatus,
              from: req.body.From,
              to: req.body.To,
              timestamp: req.body.Timestamp || new Date().toISOString(),
              duration: req.body.CallDuration || 0,
              number: req.body.Direction === 'inbound' ? req.body.From : req.body.To,
              userId: userId
          };

          // Save to database
          try {
              await CallHistory.findOneAndUpdate(
                  { callId: callSid },
                  callHistoryData,
                  { upsert: true, new: true }
              );
          } catch (dbError) {
              console.error('Error saving call history:', dbError);
          }
      }

      // Broadcast call status to all clients
      broadcastCallStatus({
          callSid: callSid,
          status: callStatus,
          from: req.body.From,
          to: req.body.To,
          timestamp: req.body.Timestamp || new Date().toISOString(),
          duration: req.body.CallDuration
      });

      // Handle terminal call states
  if (['completed', 'canceled', 'busy', 'no-answer', 'failed'].includes(callStatus)) {
          console.log(`✅ Call ${callSid} has ended. Cleaning up...`);
      activeCalls.delete(callSid);
          io.emit('callEnded', { 
              callSid,
              status: callStatus,
              timestamp: req.body.Timestamp || new Date().toISOString()
          });
  }

  res.sendStatus(200);
  } catch (error) {
      console.error('Error handling call status:', error);
      res.sendStatus(500);
  }
});

// Test endpoint to verify route is working
app.get('/api/calls/end', (req, res) => {
  res.json({ message: 'Endpoint exists. Use POST method to end calls.' });
});

app.post('/api/calls/end', async (req, res) => {
  console.log('🔴 /api/calls/end endpoint hit');
  console.log('Request body:', req.body);
  
  const { callId } = req.body;

  if (!callId) {
    console.error('❌ Missing callId in request');
    return res.status(400).json({ success: false, message: "Missing callId" });
  }

  console.log(`🔴 Attempting to end call: ${callId}`);

  try {
    // For direct calls (device.connect), just end the call SID directly
    // No need to find conference since we're using direct dialing now
    
    try {
      console.log(`📱 Ending call on Twilio: ${callId}`);
      await twilioClient.calls(callId).update({ status: 'completed' });
      console.log(`✅ Call ${callId} ended successfully on Twilio.`);
    } catch (twilioError) {
      // Call might already be ended
      console.warn(`⚠️ Could not end call ${callId} on Twilio:`, twilioError.message);
      // Don't return error - continue cleanup
    }

    // Remove call from active calls if exists
    if (activeCalls.has(callId)) {
      activeCalls.delete(callId);
      console.log(`🗑️ Removed call ${callId} from activeCalls`);
    }

    // Emit callEnded event for all clients
    console.log(`🚀 Emitting callEnded event for callSid: ${callId}`);
    io.emit('callEnded', { callSid: callId });

    console.log(`✅ Call end process completed for ${callId}`);
    res.json({ success: true, message: 'Call ended successfully' });

  } catch (error) {
    console.error("❌ Error ending call:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Voice Webhook Handler - handles device.connect() outbound calls and incoming calls
app.post('/voice', async (req, res) => {
  console.log('\n === VOICE WEBHOOK ===');
  console.log('🔍 Full Request Body:', JSON.stringify(req.body, null, 2));
  console.log('🔍 Query Params:', JSON.stringify(req.query, null, 2));
  console.log('Call Details:', {
    From: req.body.From,
    To: req.body.To || 'undefined',
    callSid: req.body.CallSid,
    Direction: req.body.Direction
  });

  const twiml = new VoiceResponse();
  
  // Check if this is an outbound call from device.connect()
  // The 'Caller' field contains the client identity, not 'From'
  const isOutboundCall = (req.body.Caller && req.body.Caller.startsWith('client:')) || 
                         (req.body.From && req.body.From.startsWith('client:'));
  
  // For device.connect(), the To parameter comes from the params object
  // Twilio sends custom params as top-level properties in the request body
  let customerNumber = null;
  
  // Check all possible locations for the customer number
  // 1. Direct To field (standard incoming calls)
  if (req.body.To && !req.body.To.startsWith('client:')) {
    customerNumber = req.body.To;
  } 
  // 2. Query parameter
  else if (req.query.To) {
    customerNumber = req.query.To;
  }
  // 3. Custom parameter from device.connect({ params: { To: ... }})
  // These appear as top-level properties in req.body
  else if (isOutboundCall) {
    // For outbound calls from client, check for custom parameters
    // Look for any property that looks like a phone number
    for (const [key, value] of Object.entries(req.body)) {
      if (key === 'To' || key === 'to' || key === 'phoneNumber' || key === 'number') {
        if (typeof value === 'string' && (value.startsWith('+') || value.match(/^\d{10,15}$/))) {
          customerNumber = value;
          console.log(`📱 Found customer number in req.body.${key}:`, customerNumber);
          break;
        }
      }
    }
  }
  
  console.log('🔍 Detection:', {
    isOutboundCall,
    customerNumber,
    caller: req.body.Caller,
    from: req.body.From,
    bodyTo: req.body.To,
    queryTo: req.query.To
  });
  
  if (isOutboundCall) {
    if (!customerNumber) {
      console.error('❌ ERROR: Outbound call from client but no customer number found!');
      twiml.say('Error: No phone number specified.');
      twiml.hangup();
      res.type('text/xml');
      return res.send(twiml.toString());
    }
    
    // This is a device.connect() outbound call - directly dial the customer
    console.log('📞 Outbound call detected! Dialing customer:', customerNumber);
    
    const callSid = req.body.CallSid;
    const userId = req.body.userId || req.query.userId;
    
    // Store call info
    if (callSid) {
      activeCalls.set(callSid, {
        callSid: callSid,
        to: customerNumber,
        status: 'initiated',
        userId: userId,
        timestamp: new Date().toISOString()
      });
      console.log('✅ Stored call info for SID:', callSid);
    }
    
    // Direct dial to customer
    const dial = twiml.dial({
      callerId: process.env.TWILIO_PHONE_NUMBER,
      record: 'record-from-answer',
      recordingStatusCallback: `${BASE_URL}/api/recording/status`,
      recordingStatusCallbackMethod: 'POST'
    });
    dial.number(customerNumber);
    
    const twimlString = twiml.toString();
    console.log('📤 Returning TwiML:', twimlString);
    
    res.type('text/xml');
    return res.send(twimlString);
  }

  // Otherwise, this is an incoming customer call
  console.log(' === INCOMING CUSTOMER CALL ===');
  
  if (!req.body.To) {
    console.error("❌ ERROR: Twilio did not send 'To' in the request.");
  }

  try {
    // Check for connected agents
    const connectedAgents = Array.from(agentStatuses.entries());
    console.log(' Connected Agents:', connectedAgents.length);
    connectedAgents.forEach(([socketId, status]) => {
      console.log(` - Agent ${socketId}: ${status}`);
    });

    if (connectedAgents.length === 0) {
      console.log(' No agents available');
      twiml.say('Sorry, all agents are currently busy. Please try again later.');
      twiml.hangup();
      return res.type('text/xml').send(twiml.toString());
    }

    const incomingConferenceName = `conf_${req.body.To || 'UnknownCall'}`;
    console.log(' Creating conference:', incomingConferenceName);

    // Store call info
    const callInfo = {
      from: req.body.From,
      to: req.body.To,
      status: 'ringing',
      conferenceName: incomingConferenceName,
      callSid: req.body.CallSid,
      timestamp: new Date().toISOString()
    };
    activeCalls.set(req.body.CallSid, callInfo);
    console.log(' Stored call info:', callInfo);

    // Notify all connected clients
    console.log(' Broadcasting incoming call to agents:', connectedAgents.length);
    const incomingCallData = {
      callSid: req.body.CallSid,
      from: req.body.From,
      to: req.body.To,
      conferenceName: incomingConferenceName,
      status: 'ringing'
    };
    console.log(' Emitting incomingCall event:', incomingCallData);
    io.emit('incomingCall', incomingCallData);

    // Create TwiML response
    twiml.say({ voice: 'alice' }, 'Please wait while we connect you to an agent.');
    const dial = twiml.dial();
    dial.conference({
      startConferenceOnEnter: false,
      endConferenceOnExit: true,
      waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical',
      waitMethod: 'GET',
      beep: false,
      statusCallbackEvent: ['start', 'end', 'join', 'leave'],
      statusCallback: `${BASE_URL}/conference-status`,
      statusCallbackMethod: 'POST',
      maxParticipants: 2
    }, incomingConferenceName);

    const twimlString = twiml.toString();
    console.log(' Generated TwiML:', twimlString);

    res.type('text/xml');
    res.send(twimlString);
  } catch (error) {
    console.error(' Error in voice webhook:', error);
    twiml.say('An error occurred. Please try your call again later.');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  }
});

app.post('/api/calls/accept', async (req, res) => {
  const { callSid } = req.body;
  console.log("callSid...............", req.body.callSid);
  // if (!callSid) return res.status(400).json({ success: false, message: 'Missing callSid' });
  console.log('🔹 Accept Call Request:', req.body.callSid);
  console.log('🔹 Active Calls:', [...activeCalls.values()]);
  const callData = [...activeCalls.values()].find(call => call.callSid === req.body.callSid);
  if (!callData) return res.status(404).json({ success: false, message: 'Call not found' });
  console.log('🔹 Active Call Data:', callData);
  try {
    const agentCall = await twilioClient.calls.create({
      url: `${BASE_URL}/join-conference?conferenceName=${callData.conferenceName}`,
      to: `client:${callSid}`,
      sid: callData.callSid,
      callSid: callData.callSid,
      CallSid: callData.CallSid,
      from: process.env.TWILIO_PHONE_NUMBER,
      statusCallback: `${BASE_URL}/api/calls/status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed', 'canceled', 'busy'],
      statusCallbackMethod: 'POST'
    });

    // ✅ Store agent call sid
    callData.agentCallSid = agentCall.sid;
    activeCalls.set(agentCall.sid, callData);  // Ensure we track it
    res.json({ success: true, agentCallSid: agentCall.sid });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/calls/reject', async (req, res) => {
  const { callSid } = req.body;
  console.log('🔴 Rejecting active call:', callSid);

  try {
      // Forcefully end the call on Twilio
      await twilioClient.calls(callSid).update({ status: 'completed' });

      res.json({ success: true, message: 'Call rejected successfully' });
  } catch (error) {
      console.error('❌ Error rejecting call:', error);
      res.status(500).json({ success: false, error: error.message });
  }
});
app.post('/join-conference', (req, res) => {
  console.log('\n🤝 === JOIN CONFERENCE REQUEST ===');

  try {
    const conferenceName = req.body.conferenceName || req.query.conferenceName;
    const callSid = req.query.callSid || req.body.callSid;

    console.log('📞 Join conference request:', { conferenceName, callSid });

    if (!conferenceName) {
      throw new Error('Conference name is required');
    }

    const twiml = new VoiceResponse();
    twiml.say('Connecting you to the caller.');

    const dial = twiml.dial();
    dial.conference({
      startConferenceOnEnter: true,
      endConferenceOnExit: false,
      beep: false,
      statusCallbackEvent: ['start', 'end', 'join', 'leave'],
      statusCallback: `${BASE_URL}/conference-status`,
      statusCallbackMethod: 'POST',
      maxParticipants: 2
    }, conferenceName);

    console.log('📜 Generated join conference TwiML:', twiml.toString());

    res.type('text/xml');
    res.send(twiml.toString());
  } catch (error) {
    console.error('❌ Error in join-conference:', error);
    const twiml = new VoiceResponse();
    twiml.say('Sorry, there was an error connecting to the conference.');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
  }
});

// Conference Status Webhook
app.post('/conference-status', (req, res) => {
  console.log('\n === CONFERENCE STATUS UPDATE ===', req.body);
  const callSid = req.body.callSid ? req.body.callSid : req.body.CallSid;
  try {
    console.log(' Conference Details:',
      '\n - ConferenceSid:', req.body.ConferenceSid,
      '\n - StatusCallbackEvent:', req.body.StatusCallbackEvent,
      '\n - CallSid:', callSid,
      '\n - Sequence Number:', req.body.SequenceNumber
    );

    res.sendStatus(200);
  } catch (error) {
    console.error(' Error in conference status webhook:', error);
    res.sendStatus(500);
  }
});
app.post('/api/twiml/fallback', (req, res) => {
  const twiml = new VoiceResponse();
  twiml.say("Sorry, we are unable to process your call at the moment. Please try again later.");
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

// Fallback voice endpoint (for TwiML App - redirects to proper endpoints)
app.post('/api/twiml/voice', (req, res) => {
  console.log('📞 Voice endpoint called (fallback):', req.body);
  
  const twiml = new VoiceResponse();
  twiml.say('This endpoint is for configuration only. Please use the dialer interface.');
  twiml.hangup();
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// Recording status callback
app.post('/api/recording/status', (req, res) => {
  console.log('🎙️ Recording status:', req.body);
  res.sendStatus(200);
});
app.get('/', (req, res) => {
  res.send('Dialer Api is Running...');
});
app.get('/api/call-history', (req, res) => {
  try {
    // Convert Map to array and sort by timestamp
    const history = Array.from(callHistory.values())
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 100); // Limit to last 100 calls
    res.json(history);
  } catch (error) {
    console.error('Error fetching call history:', error);
    res.status(500).json({ error: 'Failed to fetch call history' });
  }
});

// Start the Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(` Server is running on port ${PORT}`);
});

module.exports = app; // Export for Vercel
