#!/usr/bin/env node
/**
 * 测试 genbi-query 函数调用
 * 验证 MiniMax 2.7 模型是否正常调用并返回 thinking 字段
 */

const SUPABASE_URL = 'https://your-project.supabase.co'; // 需要替换为实际 URL
const SESSION_TOKEN = 'your-session-token'; // 需要替换为实际 token

const testData = {
  question: "哪些具体人群效果好需要增加预算，哪些人群差需要降低预算"
};

async function testGenbiQuery() {
  console.log('🔍 开始测试 genbi-query 函数调用...\n');
  
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/genbi-query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SESSION_TOKEN}`
      },
      body: JSON.stringify(testData)
    });

    console.log(`📡 响应状态: ${response.status}`);
    
    const result = await response.json();
    console.log('\n📊 响应数据:');
    console.log(JSON.stringify(result, null, 2));
    
    // 检查 thinking 字段
    if (result.thinking) {
      console.log(`\n✅ thinking 字段存在，长度: ${result.thinking.length} 字符`);
      console.log('📝 thinking 内容预览:');
      console.log(result.thinking.substring(0, 500) + (result.thinking.length > 500 ? '...' : ''));
    } else {
      console.log('\n❌ thinking 字段为空或不存在');
    }
    
    // 检查 ai_enhanced 字段
    console.log(`\n🤖 ai_enhanced: ${result.ai_enhanced}`);
    
    // 检查 answer 字段
    if (result.answer) {
      console.log(`\n💬 answer 字段长度: ${result.answer.length} 字符`);
      console.log('📝 answer 内容预览:');
      console.log(result.answer.substring(0, 300) + (result.answer.length > 300 ? '...' : ''));
    }
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

testGenbiQuery();
