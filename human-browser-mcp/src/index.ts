import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  browserNavigate,
  browserBack,
  browserForward,
  browserRefresh,
  browserGetUrl,
  browserGetContent,
  browserScreenshot,
  browserWaitFor,
  browserClick,
  browserType,
  browserClearAndType,
  browserSelect,
  browserHover,
  browserScroll,
  browserPressKey,
  browserEvaluate,
  browserGetCookies,
  browserSetCookies,
  browserClearCookies,
  browserSolveCaptcha,
} from './actions.js';

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────────────

const TOOLS = [
  // Navigation
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Target URL' },
        waitUntil: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle', 'commit'],
          description: 'When to consider navigation done (default: domcontentloaded)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_back',
    description: 'Go back in browser history',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_forward',
    description: 'Go forward in browser history',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_refresh',
    description: 'Reload the current page',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_get_url',
    description: 'Return the current page URL',
    inputSchema: { type: 'object', properties: {} },
  },

  // Reading
  {
    name: 'browser_get_content',
    description: 'Return visible text of the page (or a specific element)',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector (optional, defaults to whole page)' },
      },
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot and return it as base64 PNG',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of element to capture (optional)' },
        fullPage: { type: 'boolean', description: 'Capture full page (default false)' },
      },
    },
  },
  {
    name: 'browser_wait_for',
    description: 'Wait until a CSS selector is in the given state',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for' },
        timeout: { type: 'number', description: 'Timeout in ms (default: BROWSER_TIMEOUT env var)' },
        state: {
          type: 'string',
          enum: ['attached', 'detached', 'visible', 'hidden'],
          description: 'Element state to wait for (default: visible)',
        },
      },
      required: ['selector'],
    },
  },

  // Interactions
  {
    name: 'browser_click',
    description: 'Human-like click on an element via ghost-cursor (realistic mouse trajectory)',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of element to click' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text character by character with Gaussian typing delays (30–120 ms/char)',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of input element' },
        text: { type: 'string', description: 'Text to type' },
        clearFirst: { type: 'boolean', description: 'Select-all before typing (default false)' },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'browser_clear_and_type',
    description: 'Clear an input field then type text with human delays',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of input element' },
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'browser_select',
    description: 'Select an option in a <select> element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of <select>' },
        value: { type: 'string', description: 'Option value to select' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'browser_hover',
    description: 'Move the mouse over an element with a realistic ghost-cursor path',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of element to hover' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page with non-linear micro-paused chunks',
    inputSchema: {
      type: 'object',
      properties: {
        deltaX: { type: 'number', description: 'Horizontal scroll amount in pixels (default 0)' },
        deltaY: { type: 'number', description: 'Vertical scroll amount in pixels (default 300, negative = up)' },
        selector: { type: 'string', description: 'CSS selector to scroll into view first (optional)' },
        steps: { type: 'number', description: 'Number of scroll micro-steps (auto-computed if omitted)' },
      },
    },
  },
  {
    name: 'browser_press_key',
    description: 'Press a keyboard key (e.g. Enter, Tab, Escape, ArrowDown)',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Playwright key name (e.g. Enter, Tab, Escape)' },
        modifiers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Modifier keys to hold (e.g. ["Shift", "Control"])',
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_evaluate',
    description: 'Execute arbitrary JavaScript in the page context and return the result',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'JavaScript expression or IIFE to evaluate' },
      },
      required: ['script'],
    },
  },

  // Session
  {
    name: 'browser_get_cookies',
    description: 'Return all cookies from the current browser context',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_set_cookies',
    description: 'Add or update cookies in the current browser context',
    inputSchema: {
      type: 'object',
      properties: {
        cookies: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              value: { type: 'string' },
              domain: { type: 'string' },
              path: { type: 'string' },
              httpOnly: { type: 'boolean' },
              secure: { type: 'boolean' },
              sameSite: { type: 'string', enum: ['Strict', 'Lax', 'None'] },
            },
            required: ['name', 'value', 'domain'],
          },
          description: 'Array of cookie objects',
        },
      },
      required: ['cookies'],
    },
  },
  {
    name: 'browser_clear_cookies',
    description: 'Clear all cookies from the current browser context',
    inputSchema: { type: 'object', properties: {} },
  },

  // CapSolver (optional)
  {
    name: 'browser_solve_captcha',
    description:
      'Detect and solve a captcha on the current page using CapSolver (requires CAPSOLVER_API_KEY env var)',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description:
            'Captcha type: ReCaptchaV2Task, ReCaptchaV3Task, HCaptchaTask, AntiTurnstileTask, or "auto"',
        },
      },
    },
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch table
// ─────────────────────────────────────────────────────────────────────────────

type ActionFn = (args: any) => Promise<any>;

const ACTIONS: Record<string, ActionFn> = {
  browser_navigate: browserNavigate,
  browser_back: browserBack,
  browser_forward: browserForward,
  browser_refresh: browserRefresh,
  browser_get_url: browserGetUrl,
  browser_get_content: browserGetContent,
  browser_screenshot: browserScreenshot,
  browser_wait_for: browserWaitFor,
  browser_click: browserClick,
  browser_type: browserType,
  browser_clear_and_type: browserClearAndType,
  browser_select: browserSelect,
  browser_hover: browserHover,
  browser_scroll: browserScroll,
  browser_press_key: browserPressKey,
  browser_evaluate: browserEvaluate,
  browser_get_cookies: browserGetCookies,
  browser_set_cookies: browserSetCookies,
  browser_clear_cookies: browserClearCookies,
  browser_solve_captcha: browserSolveCaptcha,
};

// ─────────────────────────────────────────────────────────────────────────────
// Server bootstrap
// ─────────────────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'human-browser', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const action = ACTIONS[name];
  if (!action) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }
  return action(args ?? {});
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('human-browser MCP server running on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
