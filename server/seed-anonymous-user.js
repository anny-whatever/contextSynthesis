const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function seedAnonymousUser() {
  try {
    // Check if anonymous user already exists
    const existingUser = await prisma.user.findUnique({
      where: { id: 'anonymous' }
    });

    if (existingUser) {
      console.log('Anonymous user already exists');
      return;
    }

    // Create anonymous user
    const anonymousUser = await prisma.user.create({
      data: {
        id: 'anonymous',
        email: 'anonymous@example.com',
        name: 'Anonymous User'
      }
    });

    console.log('Anonymous user created:', anonymousUser);
  } catch (error) {
    console.error('Error creating anonymous user:', error);
  } finally {
    await prisma.$disconnect();
  }
}

seedAnonymousUser();