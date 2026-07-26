#!/usr/bin/env node

/**
 * Zhihu MCP Server
 * Provides authenticated access to Zhihu API with zse96 v2 signing
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { signRequest } from './zse-signer.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_DIR = path.join(os.homedir(), '.zhihu-mcp');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Ensure config directory exists
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Default configuration
let config = {
  cookies: {},
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  zse93: '101_3_3.0'
};

// Load configuration
if (fs.existsSync(CONFIG_FILE)) {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  } catch (e) {
    console.error('Failed to load config:', e);
  }
}

// Save configuration
function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Android API headers (for guest access)
const ANDROID_HEADERS = {
  'x-api-version': '3.1.8',
  'x-app-version': '10.61.0',
  'x-app-za': 'OS=Android&Release=12&Model=sdk_gphone64_arm64&VersionName=10.61.0&VersionCode=26107&Product=com.zhihu.android&Width=1440&Height=2952&Installer=%E7%81%B0%E5%BA%A6&DeviceType=AndroidPhone&Brand=google',
  'User-Agent': 'com.zhihu.android/Futureve/10.61.0 Mozilla/5.0 (Linux; Android 12; sdk_gphone64_arm64 Build/SE1A.220630.001.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/57.0.1000.10 Mobile Safari/537.36'
};

// HTTP request helper for Android API (no signing needed)
async function zhihuAndroidRequest(url, options = {}) {
  const headers = {
    ...ANDROID_HEADERS,
    ...options.headers
  };

  // Add cookies if available
  if (Object.keys(config.cookies).length > 0) {
    headers['Cookie'] = Object.entries(config.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

// HTTP request helper
async function zhihuRequest(url, options = {}) {
  const method = options.method || 'GET';
  const body = options.body ? JSON.stringify(options.body) : null;

  const headers = {
    'User-Agent': config.userAgent,
    'x-zse-93': config.zse93,
    'x-requested-with': 'fetch',
    ...options.headers
  };

  // Add cookies
  if (Object.keys(config.cookies).length > 0) {
    headers['Cookie'] = Object.entries(config.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  // Sign request
  const dc0 = config.cookies['d_c0'] || '';
  const signature = signRequest(url, dc0, body, config.zse93);
  headers['x-zse-96'] = signature;

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

// Create MCP server
const server = new Server(
  {
    name: 'zhihu-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'zhihu_hot_list',
        description: '获取知乎热榜内容。返回当前热门话题列表，包括标题、热度、链接等信息。',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: '返回结果数量限制，默认 50',
              default: 50
            }
          }
        }
      },
      {
        name: 'zhihu_search',
        description: '搜索知乎内容。可以搜索问题、回答、文章、用户等。支持通用搜索。',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '搜索关键词'
            },
            limit: {
              type: 'number',
              description: '返回结果数量，默认 10',
              default: 10
            },
            offset: {
              type: 'number',
              description: '分页偏移量，默认 0',
              default: 0
            }
          },
          required: ['query']
        }
      },
      {
        name: 'zhihu_hot_search',
        description: '获取知乎热搜词。返回当前热门搜索关键词列表。',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'zhihu_get_question',
        description: '获取知乎问题详情。返回问题的标题、描述、关注数、回答数等信息。',
        inputSchema: {
          type: 'object',
          properties: {
            question_id: {
              type: 'string',
              description: '问题 ID'
            }
          },
          required: ['question_id']
        }
      },
      {
        name: 'zhihu_get_answer',
        description: '获取知乎回答详情。返回回答的内容、作者、点赞数、评论数等信息。',
        inputSchema: {
          type: 'object',
          properties: {
            answer_id: {
              type: 'string',
              description: '回答 ID'
            }
          },
          required: ['answer_id']
        }
      },
      {
        name: 'zhihu_get_article',
        description: '获取知乎文章详情。返回文章的标题、内容、作者、点赞数等信息。',
        inputSchema: {
          type: 'object',
          properties: {
            article_id: {
              type: 'string',
              description: '文章 ID'
            }
          },
          required: ['article_id']
        }
      },
      {
        name: 'zhihu_question_answers',
        description: '获取问题的回答列表。返回指定问题下的回答列表。',
        inputSchema: {
          type: 'object',
          properties: {
            question_id: {
              type: 'string',
              description: '问题 ID'
            },
            limit: {
              type: 'number',
              description: '返回结果数量，默认 20',
              default: 20
            },
            offset: {
              type: 'number',
              description: '分页偏移量，默认 0',
              default: 0
            },
            sort: {
              type: 'string',
              description: '排序方式：default（默认）、updated（最新）',
              enum: ['default', 'updated'],
              default: 'default'
            }
          },
          required: ['question_id']
        }
      },
      {
        name: 'zhihu_get_user',
        description: '获取知乎用户信息。返回用户的昵称、简介、关注数、粉丝数等信息。',
        inputSchema: {
          type: 'object',
          properties: {
            user_token: {
              type: 'string',
              description: '用户 URL token 或 ID'
            }
          },
          required: ['user_token']
        }
      },
      {
        name: 'zhihu_set_cookies',
        description: '设置知乎登录 Cookie。用于认证和访问需要登录的内容。可以从浏览器开发者工具中获取 Cookie。',
        inputSchema: {
          type: 'object',
          properties: {
            cookies: {
              type: 'object',
              description: 'Cookie 键值对，至少需要 d_c0',
              additionalProperties: {
                type: 'string'
              }
            }
          },
          required: ['cookies']
        }
      },
      {
        name: 'zhihu_get_config',
        description: '获取当前配置信息（不包含敏感 Cookie 值）。',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'zhihu_hot_list': {
        const limit = args.limit || 50;
        const url = `https://api.zhihu.com/topstory/hot-list?limit=${limit}`;
        const data = await zhihuAndroidRequest(url);

        const items = data.data || [];
        const formatted = {
          total: items.length,
          hot_list: items.map((item, index) => ({
            rank: index + 1,
            title: item.target?.title_area?.text || 'N/A',
            excerpt: item.target?.excerpt_area?.text || '',
            type: item.type || 'hot_list_feed',
            url: item.target?.link?.url || '',
            hot_value: item.target?.metrics_area?.text || ''
          }))
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(formatted, null, 2)
            }
          ]
        };
      }

      case 'zhihu_search': {
        const { query, limit = 10, offset = 0 } = args;
        const encodedQuery = encodeURIComponent(query);
        const url = `https://www.zhihu.com/api/v4/search_v3?gk_version=gz-gaokao&t=general&q=${encodedQuery}&correction=1&search_source=Normal&limit=${limit}&offset=${offset}`;
        const data = await zhihuRequest(url);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2)
            }
          ]
        };
      }

      case 'zhihu_hot_search': {
        const url = 'https://www.zhihu.com/api/v4/search/hot_search';
        const data = await zhihuRequest(url);

        const hotSearches = data.hot_search_queries || [];
        const formatted = {
          total: hotSearches.length,
          hot_searches: hotSearches.map(item => ({
            query: item.query,
            hot: item.hot_show || item.hot,
            label: item.label,
            index: item.index + 1
          }))
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(formatted, null, 2)
            }
          ]
        };
      }

      case 'zhihu_get_question': {
        const { question_id } = args;
        const url = `https://www.zhihu.com/api/v4/questions/${question_id}?include=read_count,visit_count,answer_count,voteup_count,comment_count,follower_count,detail,excerpt,author,relationship.is_following,topics`;
        const data = await zhihuRequest(url);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2)
            }
          ]
        };
      }

      case 'zhihu_get_answer': {
        const { answer_id } = args;
        const url = `https://www.zhihu.com/api/v4/answers/${answer_id}?include=content,paid_info,can_comment,excerpt,thanks_count,voteup_count,comment_count,visited_count,attachment,reaction,ip_info,pagination_info,question.topics,reaction.relation.voting,author.badge_v2`;
        const data = await zhihuRequest(url);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2)
            }
          ]
        };
      }

      case 'zhihu_get_article': {
        const { article_id } = args;
        const url = `https://www.zhihu.com/api/v4/articles/${article_id}?include=content,topics,paid_info,can_comment,excerpt,thanks_count,voteup_count,comment_count,visited_count,relationship,ip_info,relationship.vote,author.badge_v2`;
        const data = await zhihuRequest(url);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2)
            }
          ]
        };
      }

      case 'zhihu_question_answers': {
        const { question_id, limit = 20, offset = 0, sort = 'default' } = args;
        const url = `https://www.zhihu.com/api/v4/questions/${question_id}/feeds?limit=${limit}&offset=${offset}&order=${sort}`;
        const data = await zhihuRequest(url);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2)
            }
          ]
        };
      }

      case 'zhihu_get_user': {
        const { user_token } = args;
        const url = `https://www.zhihu.com/api/v4/members/${user_token}`;
        const data = await zhihuRequest(url);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2)
            }
          ]
        };
      }

      case 'zhihu_set_cookies': {
        config.cookies = { ...config.cookies, ...args.cookies };
        saveConfig();

        return {
          content: [
            {
              type: 'text',
              text: 'Cookies 已更新并保存'
            }
          ]
        };
      }

      case 'zhihu_get_config': {
        const safeConfig = {
          userAgent: config.userAgent,
          zse93: config.zse93,
          hasCookies: Object.keys(config.cookies).length > 0,
          cookieKeys: Object.keys(config.cookies)
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(safeConfig, null, 2)
            }
          ]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`
        }
      ],
      isError: true
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Zhihu MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
