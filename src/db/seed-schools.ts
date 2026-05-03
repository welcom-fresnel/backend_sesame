import { initializePool, getPool, closePool, queryOne, query } from './index.js';
import { pathToFileURL } from 'url';

const seedSchools = async () => {
  try {
    // Initialize pool first
    initializePool();
    
    console.log('🔄 Seeding schools...');

    const schools = [
      {
        name: 'Université de Paris',
        city: 'Paris',
        country: 'France',
        email_domain: 'universite-paris.fr',
        description: 'Université de Paris - Partenaire SESSAME',
      },
      {
        name: 'Université de Lyon',
        city: 'Lyon',
        country: 'France',
        email_domain: 'universite-lyon.fr',
        description: 'Université de Lyon - Partenaire SESSAME',
      },
      {
        name: 'Université de Marseille',
        city: 'Marseille',
        country: 'France',
        email_domain: 'universite-marseille.fr',
        description: 'Université de Marseille - Partenaire SESSAME',
      },
      {
        name: 'Université de Bordeaux',
        city: 'Bordeaux',
        country: 'France',
        email_domain: 'universite-bordeaux.fr',
        description: 'Université de Bordeaux - Partenaire SESSAME',
      },
      {
        name: 'École Polytechnique',
        city: 'Palaiseau',
        country: 'France',
        email_domain: 'polytechnique.fr',
        description: 'École Polytechnique - Partenaire SESSAME',
      },
    ];

    for (const school of schools) {
      // Vérifier si l'école existe déjà
      const existingSchool = await queryOne(
        `SELECT id FROM schools WHERE email_domain = $1`,
        [school.email_domain]
      );

      if (!existingSchool) {
        const createdSchool = await queryOne(
          `INSERT INTO schools (name, city, country, email_domain, description)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, name, email_domain`,
          [school.name, school.city, school.country, school.email_domain, school.description]
        );

        console.log(`✅ School created: ${createdSchool.name} (${createdSchool.email_domain})`);
      } else {
        console.log(`⏭️  School already exists: ${school.email_domain}`);
      }
    }

    console.log('\n✅ Schools seeding completed successfully');
  } catch (error) {
    console.error('❌ Seed error:', error);
    throw error;
  }
};

// Main execution
const isMainModule =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  (async () => {
    try {
      await seedSchools();
      await closePool();
      process.exit(0);
    } catch (error) {
      console.error(error);
      await closePool();
      process.exit(1);
    }
  })();
}
