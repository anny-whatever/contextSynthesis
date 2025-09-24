const axios = require('axios');

const BASE_URL = 'http://localhost:3001/api';

async function testChatFlow() {
  try {
    console.log('🚀 Testing Agentic Chatbot Flow...\n');

    // Test 1: Health check
    console.log('1. Testing health check...');
    const healthResponse = await axios.get(`${BASE_URL.replace('/api', '')}/health`);
    console.log('✅ Health check:', healthResponse.data);

    // Test 2: Create a conversation without userId (anonymous)
    console.log('\n2. Creating a new conversation...');
    const conversationResponse = await axios.post(`${BASE_URL}/chat/conversations`, {
      title: 'Test Conversation'
    });
    console.log('✅ Conversation created:', conversationResponse.data);
    const conversationId = conversationResponse.data.data.id;

    // Test 3: Send a message that should trigger web search
    console.log('\n3. Sending a message that should trigger web search...');
    const chatResponse = await axios.post(`${BASE_URL}/chat`, {
      message: 'What are the latest developments in AI and machine learning in 2024?',
      conversationId,
      context: { searchEnabled: true }
    });
    console.log('✅ Chat response:', JSON.stringify(chatResponse.data, null, 2));

    // Test 4: Get conversation messages
    console.log('\n4. Retrieving conversation messages...');
    const messagesResponse = await axios.get(`${BASE_URL}/chat/conversations/${conversationId}/messages`);
    console.log('✅ Messages retrieved:', messagesResponse.data);

    // Test 5: Get conversation details
    console.log('\n5. Getting conversation details...');
    const detailsResponse = await axios.get(`${BASE_URL}/chat/conversations/${conversationId}`);
    console.log('✅ Conversation details:', detailsResponse.data);

    console.log('\n🎉 All tests passed! The agentic chatbot flow is working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    if (error.response?.status) {
      console.error('Status:', error.response.status);
    }
  }
}

// Run the test
testChatFlow();