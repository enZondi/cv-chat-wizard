import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message } = await req.json();

    if (!message) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const azureOpenAIKey = Deno.env.get('AZURE_OPENAI_API_KEY');
    const azureOpenAIEndpoint = "https://round2letsgo.openai.azure.com/";
    const azureOpenAIVersion = "2024-05-01-preview";
    const assistantId = "asst_pX2hJzVdruY2vW0rte3nFiNr"; // Your assistant ID

    if (!azureOpenAIKey) {
      return new Response(
        JSON.stringify({ error: 'Azure OpenAI API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create thread
    const threadResponse = await fetch(`${azureOpenAIEndpoint}openai/threads?api-version=${azureOpenAIVersion}`, {
      method: 'POST',
      headers: {
        'api-key': azureOpenAIKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!threadResponse.ok) {
      const error = await threadResponse.text();
      console.error('Thread creation failed:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to create thread' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const thread = await threadResponse.json();

    // Add user message to thread
    const messageResponse = await fetch(`${azureOpenAIEndpoint}openai/threads/${thread.id}/messages?api-version=${azureOpenAIVersion}`, {
      method: 'POST',
      headers: {
        'api-key': azureOpenAIKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: "user",
        content: message
      }),
    });

    if (!messageResponse.ok) {
      const error = await messageResponse.text();
      console.error('Message creation failed:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to add message' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Run the assistant
    const runResponse = await fetch(`${azureOpenAIEndpoint}openai/threads/${thread.id}/runs?api-version=${azureOpenAIVersion}`, {
      method: 'POST',
      headers: {
        'api-key': azureOpenAIKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assistant_id: assistantId
      }),
    });

    if (!runResponse.ok) {
      const error = await runResponse.text();
      console.error('Run creation failed:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to run assistant' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const run = await runResponse.json();

    // Poll for completion
    let runStatus = run.status;
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max

    while ((runStatus === 'queued' || runStatus === 'in_progress') && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const statusResponse = await fetch(`${azureOpenAIEndpoint}openai/threads/${thread.id}/runs/${run.id}?api-version=${azureOpenAIVersion}`, {
        headers: {
          'api-key': azureOpenAIKey,
        },
      });

      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        runStatus = statusData.status;
      }
      
      attempts++;
    }

    if (runStatus !== 'completed') {
      return new Response(
        JSON.stringify({ error: `Assistant run failed with status: ${runStatus}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get messages from thread
    const messagesResponse = await fetch(`${azureOpenAIEndpoint}openai/threads/${thread.id}/messages?api-version=${azureOpenAIVersion}`, {
      headers: {
        'api-key': azureOpenAIKey,
      },
    });

    if (!messagesResponse.ok) {
      const error = await messagesResponse.text();
      console.error('Failed to get messages:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to retrieve messages' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const messages = await messagesResponse.json();
    const assistantMessage = messages.data[0]?.content[0]?.text?.value;

    if (!assistantMessage) {
      return new Response(
        JSON.stringify({ error: 'No response from assistant' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ reply: assistantMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in chat function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});