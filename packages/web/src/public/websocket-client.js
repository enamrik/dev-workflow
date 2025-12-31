/**
 * WebSocket client for real-time updates
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Ping/pong keepalive
 * - Page-specific update handlers
 */
(function() {
  'use strict';

  // Configuration
  var RECONNECT_BASE_DELAY = 1000; // 1 second
  var RECONNECT_MAX_DELAY = 30000; // 30 seconds
  var PING_INTERVAL = 30000; // 30 seconds

  // State
  var socket = null;
  var reconnectAttempts = 0;
  var pingInterval = null;

  /**
   * Determine the current page context
   */
  function getPageContext() {
    var path = window.location.pathname;

    if (path === '/') {
      return { page: 'issues-list' };
    }

    var issueMatch = path.match(/^\/issues\/(\d+)$/);
    if (issueMatch) {
      return { page: 'issue-detail', issueNumber: parseInt(issueMatch[1], 10) };
    }

    if (path === '/board') {
      var params = new URLSearchParams(window.location.search);
      var issueFilter = params.get('issue');
      return {
        page: 'kanban-board',
        issueNumber: issueFilter ? parseInt(issueFilter, 10) : null
      };
    }

    return { page: 'unknown' };
  }

  /**
   * Connect to WebSocket server
   */
  function connect() {
    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsUrl = protocol + '//' + window.location.host + '/ws';

    socket = new WebSocket(wsUrl);

    socket.onopen = function() {
      console.log('[WS] Connected');
      reconnectAttempts = 0;

      // Start ping interval
      pingInterval = setInterval(function() {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL);
    };

    socket.onmessage = function(event) {
      try {
        var message = JSON.parse(event.data);
        handleMessage(message);
      } catch (error) {
        console.error('[WS] Failed to parse message:', error);
      }
    };

    socket.onclose = function() {
      console.log('[WS] Disconnected');
      cleanup();
      scheduleReconnect();
    };

    socket.onerror = function(error) {
      console.error('[WS] Error:', error);
    };
  }

  /**
   * Clean up resources
   */
  function cleanup() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  function scheduleReconnect() {
    var delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts),
      RECONNECT_MAX_DELAY
    );
    reconnectAttempts++;

    console.log('[WS] Reconnecting in ' + delay + 'ms (attempt ' + reconnectAttempts + ')');

    setTimeout(function() {
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        connect();
      }
    }, delay);
  }

  /**
   * Handle incoming WebSocket message
   */
  function handleMessage(message) {
    if (message.type === 'connected') {
      console.log('[WS] Server says:', message.payload.message);
      return;
    }

    if (message.type === 'pong') {
      return; // Keepalive response, ignore
    }

    if (message.type === 'event') {
      handleDomainEvent(message.payload);
    }
  }

  /**
   * Handle domain event based on current page
   */
  function handleDomainEvent(event) {
    var context = getPageContext();
    console.log('[WS] Event:', event.type, 'Page:', context.page);

    // Dispatch to page-specific handler
    switch (context.page) {
      case 'issues-list':
        handleIssuesListEvent(event);
        break;
      case 'issue-detail':
        handleIssueDetailEvent(event, context.issueNumber);
        break;
      case 'kanban-board':
        handleKanbanBoardEvent(event, context.issueNumber);
        break;
    }
  }

  /**
   * Handler for issues list page
   */
  function handleIssuesListEvent(event) {
    // Any issue or task change should refresh the list
    var relevantEvents = [
      'issue:created', 'issue:updated', 'issue:closed',
      'task:status_changed', 'task:created', 'task:deleted',
      'plan:generated'
    ];

    if (relevantEvents.indexOf(event.type) !== -1) {
      // Reload the page to show updated data
      window.location.reload();
    }
  }

  /**
   * Handler for issue detail page
   */
  function handleIssueDetailEvent(event, currentIssueNumber) {
    // Only react to events for this issue
    var payload = event.payload;
    if (payload.issueNumber !== currentIssueNumber) {
      return;
    }

    // Reload for any relevant change
    var relevantEvents = [
      'issue:updated', 'issue:closed',
      'plan:generated', 'plan:updated',
      'task:created', 'task:updated', 'task:status_changed', 'task:deleted',
      'task:session_started', 'task:session_completed', 'task:session_abandoned',
      'snapshot:created', 'snapshot:reverted'
    ];

    if (relevantEvents.indexOf(event.type) !== -1) {
      window.location.reload();
    }
  }

  /**
   * Handler for kanban board page
   */
  function handleKanbanBoardEvent(event, filterIssueNumber) {
    // If filtering by issue, only react to that issue's events
    if (filterIssueNumber && event.payload.issueNumber !== filterIssueNumber) {
      return;
    }

    // Task status changes are most relevant to kanban
    var relevantEvents = [
      'task:status_changed', 'task:created', 'task:deleted',
      'task:session_started', 'task:session_completed', 'task:session_abandoned'
    ];

    if (relevantEvents.indexOf(event.type) !== -1) {
      window.location.reload();
    }
  }

  // Initialize on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', function() {
    connect();
  });

  // Clean up on page unload
  window.addEventListener('beforeunload', function() {
    cleanup();
    if (socket) {
      socket.close();
    }
  });
})();
