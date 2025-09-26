#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';

async function checkDbSchema() {
  const prisma = new PrismaClient();

  try {
    console.log('🔍 Checking database schema...\n');
    
    // Check if the conversation_summaries table exists and what columns it has
    const result = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'conversation_summaries'
      ORDER BY ordinal_position;
    `;

    console.log('📋 Columns in conversation_summaries table:');
    console.log(result);

    // Check if vector extension is installed
    const extensions = await prisma.$queryRaw`
      SELECT extname FROM pg_extension WHERE extname = 'vector';
    `;

    console.log('\n🔌 Vector extension status:');
    console.log(extensions);

    // Check if there are any summaries
    const summaryCount = await prisma.conversationSummary.count();
    console.log(`\n📊 Total conversation summaries: ${summaryCount}`);

  } catch (error) {
    console.error('❌ Error checking database schema:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDbSchema().catch(console.error);