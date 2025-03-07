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
const app = express();
const server = http.createServer(app);
console.log(process.env.CLIENT_URL)
const io = new Server(server, {
  cors: {
    origin: [`${process.env.CLIENT_URL}`, 'https://zolara-dialer-frontend.vercel.app', "http://localhost:3000", "https://zolara-dialer.vercel.app"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH", "CONNECT", "TRACE", "PURGE"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});
connectDB()
const allowedOrigins = [
  `${process.env.CLIENT_URL}`,'https://zolara-dialer-frontend.vercel.app', 'http://localhost:3000', 'https://zolara-dialer.vercel.app'
];

// Middleware
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(origin + ' Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH', 'CONNECT', 'TRACE', 'PURGE'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

  console.log(`🚀 Initiating call to ${to} from ${from}`);

  try {
    const formattedNumber = to.startsWith('+') ? to : `+${to}`;

    const call = await twilioClient.calls.create({
      url: `${process.env.BASE_URL}/api/twiml/connect?To=${encodeURIComponent(formattedNumber)}`,
      to: formattedNumber,
      from: from,
      record: true,
      statusCallback: `${process.env.BASE_URL}/api/calls/status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed', 'canceled', 'busy'],
      statusCallbackMethod: 'POST',
      timeout: 60
    });
    console.log(userId, 'User Id....')
    // Store original outbound call with userId
    activeCalls.set(call.sid, { 
      callSid: call.sid, 
      to: formattedNumber, 
      status: 'initiated', 
      conferenceName: `conf_${formattedNumber}`,
      userId: userId 
    });

    console.log(`📞 Call created with SID: ${call.sid}`);

    res.json({ success: true, callId: call.sid });
  } catch (error) {
    console.error('❌ Error initiating call:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/twiml/connect', async (req, res) => {
  let { callSid } = req.body;
  if (callSid == undefined) {
    callSid = req.body.CallSid;
  }
  console.log(req.body);

  if (!callSid) {
    console.error("❌ Missing CallSid in /connect request.");
    return res.status(400).json({ success: false, error: "Missing callSid" });
  }
  // Fetch the correct active call
  const conferenceName = [...activeCalls.values()][0].conferenceName;
  console.log("Active Calls", activeCalls)
  console.log("active call conference name", conferenceName)
 
 
  // TwiML to connect agent to conference
  const twiml = new VoiceResponse();
  const dial = twiml.dial();
  dial.conference({
    startConferenceOnEnter: true,
    endConferenceOnExit: false,
    beep: false,
    waitUrl: "http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical",
    statusCallbackEvent: ["start", "end", "join", "leave"],
    statusCallback: `${process.env.BASE_URL}/conference-status`,
    statusCallbackMethod: "POST",
    maxParticipants: 2
  }, conferenceName);

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

app.post('/api/calls/end', async (req, res) => {
  const { callId } = req.body;

  if (!callId) {
    return res.status(400).json({ success: false, message: "Missing callId" });
  }

  console.log(`🔴 Attempting to end call: ${callId}`);

  try {
    // Step 1: Find the active call
    const callData = activeCalls.get(callId);
    if (!callData) {
      console.warn(`⚠️ Call ${callId} not found in activeCalls.`);
      return res.status(404).json({ success: false, message: "Call not found" });
    }

    console.log(`🔍 Fetching active conference for: ${callData.to}`);

    // Step 2: Fetch the **actual conference SID**
    const conferences = await twilioClient.conferences.list({ status: 'in-progress', limit: 20 });
    const matchingConference = conferences.find(conf => conf.friendlyName === `conf_${callData.to}`);
    console.log("Matching Conference", conferences)
    if (!matchingConference) {  
      console.warn(`⚠️ No active conference found for ${callData.to}. It may have already ended.`);
      return res.status(404).json({ success: false, message: "Conference not found" });
    }

    console.log(`✅ Found active conference: ${matchingConference.sid}, ending it now...`);

    // Step 3: Remove all participants from the conference
    const participants = await twilioClient.conferences(matchingConference.sid).participants.list();
    for (let participant of participants) {
      console.log(`🔴 Removing participant: ${participant.callSid}`);
      await twilioClient.conferences(matchingConference.sid).participants(participant.callSid).remove();
    }

    // Step 4: End the Twilio call for the mobile user
    if (callData.callSid) {
      try {
        console.log(`📱 Ending call on Twilio: ${callData.callSid}`);
        await twilioClient.calls(callData.callSid).update({ status: 'completed' });
      } catch (error) {
        console.error(`❌ Error ending callSid ${callData.callSid} on Twilio:`, error);
      }
    }

    // Step 5: Remove call from active calls
    activeCalls.delete(callId);

    // **NEW: Emit `callEnded` event for all clients**
    console.log(`🚀 Emitting callEnded event for callSid: ${callId}`);
    io.emit('callEnded', { callSid: callId });

    console.log(`✅ Call and conference ${matchingConference.sid} ended successfully.`);

    res.json({ success: true });

  } catch (error) {
    console.error("❌ Error ending call:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Voice Webhook Handler
app.post('/voice', async (req, res) => {
  console.log('\n === INCOMING CALL WEBHOOK ===');
  console.log('🔍 Raw Webhook Request:', JSON.stringify(req.body, null, 2));
  console.log('Call Details:', {
    From: req.body.From,
    To: req.body.To,
    callSid: req.body.CallSid,
    Direction: req.body.Direction
  });

  const twiml = new VoiceResponse();
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

    const conferenceName = `conf_${req.body.To || 'UnknownCall'}`;
    console.log(' Creating conference:', conferenceName);

    // Store call info
    const callInfo = {
      from: req.body.From,
      to: req.body.To,
      status: 'ringing',
      conferenceName,
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
      conferenceName,
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
      statusCallback: `${process.env.BASE_URL}/conference-status`,
      statusCallbackMethod: 'POST',
      maxParticipants: 2
    }, conferenceName);

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
      url: `${process.env.BASE_URL}/join-conference?conferenceName=${callData.conferenceName}`,
      to: `client:${callSid}`,
      sid: callData.callSid,
      callSid: callData.callSid,
      CallSid: callData.CallSid,
      from: process.env.TWILIO_PHONE_NUMBER,
      statusCallback: `${process.env.BASE_URL}/api/calls/status`,
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
      statusCallback: `${process.env.BASE_URL}/conference-status`,
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
