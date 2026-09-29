/* Site content for the Steel Access Doors redesign.
 *
 * Facts (product range, feature names, applications, contact details) follow the
 * current steelaccessdoors.com site. Descriptions are rewritten for this redesign;
 * edit them freely. Every page on the site is rendered from this file.
 */
(function () {
  // Photos are served from the live site. To self-host, copy the images into
  // ./img/ keeping the same file names and set IMAGE_BASE to './'.
  const IMAGE_BASE = 'https://www.steelaccessdoors.com/';

  const company = {
    name: 'Steel Access Doors',
    short: 'SA',
    tagline: 'Turnkey clean room solutions, engineered in steel.',
    email: 'sales@steelaccessdoors.com',
    phones: ['+91 90006 88843', '+91 90009 79714', '+91 98665 62263'],
    whatsapp: '919000688843',
    address: 'Plot No. A3/5, IDA Gandhi Nagar, Balanagar, Hyderabad – 500037',
    mapEmbed:
      'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d407.87448431060045!2d78.43134309999999!3d17.4889024!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3bcb91002f6166d7%3A0x9d57c2c43a2b40cc!2sSteel%20Access%20Doors!5e1!3m2!1sen!2sin!4v1729081459149!5m2!1sen!2sin',
    mapLink: 'https://maps.google.com/?q=Steel+Access+Doors+Balanagar+Hyderabad',
    brochure: IMAGE_BASE + 'img/products/SA%20broucher.pdf',
    logo: IMAGE_BASE + 'img/access-logo.png',
    year: 2024,
  };

  const announcement = {
    title: 'We are now BFRC certified',
    body:
      'Steel Access Doors has earned BFRC certification, independent confirmation that our products meet advanced benchmarks for performance, safety and durability.',
    points: ['Superior engineering', 'Precision manufacturing', 'Long-term reliability'],
    closing:
      'The certification reinforces our place as an industry leader delivering high-performance solutions that meet global standards.',
    badge: 'Trusted. Certified. Reliable.',
  };

  const home = {
    welcome:
      'Your trusted partner for clean room solutions. We deliver turnkey products and services that keep pharmaceutical operations clean, safe and cost-efficient.',
    pillars: [
      'High-quality service, recognised by industry experts',
      'Guaranteed functionality and performance',
      'Adaptable solutions with rapid installation',
      'Compliance with strict pharma industry standards',
    ],
    stats: [
      { value: 99, suffix: '+', label: 'Medical & pharma clients supplied' },
      { value: 200, suffix: '+', label: 'Skilled professionals on our team' },
      { value: 19, suffix: '', label: 'Products, from doors to full OTs' },
    ],
    why: [
      {
        icon: 'shield',
        title: 'Good Quality',
        text: 'Every product is built from quality steel and proven materials, finished for hygienic, long-life service.',
      },
      {
        icon: 'tool',
        title: 'Customized Service',
        text: 'We design and build equipment around your pharmacy operations, layouts and process requirements.',
      },
      {
        icon: 'bolt',
        title: 'Quick Response',
        text: 'Our team replies to every enquiry promptly by email, or call us directly and speak to an engineer.',
      },
    ],
    featured: ['metal-doors', 'static-passbox', 'dispensing-booth', 'crossover-bench', 'gi-work-table', 'work-table-ss', 'modular-ot'],
  };

  const about = {
    intro:
      'At Steel Access Doors we are dedicated to exceptional clean room products and services, and we work to stay among the world’s leading suppliers of turnkey solutions.',
    reputation: [
      'Unwavering commitment to quality and customer satisfaction',
      'A proven record of successful projects and long-term partnerships',
      'Expertise in designing and delivering tailored clean room solutions',
      'Adherence to rigorous industry standards and regulations',
    ],
    closing:
      'Our turnkey approach means seamless integration, minimal disruption and maximum efficiency, so your pharmacy operations run in a clean, safe and cost-effective environment.',
    valuesIntro: 'Steel Access Doors has always been value driven. These are the principles we practise every day.',
    values: [
      { title: 'Company – Employees', text: 'We keep both first, in this order, and let that principle guide every decision we make.' },
      { title: 'Safety', text: 'Safe work comes before everything else in how we execute a project.' },
      { title: 'Team Work', text: 'People with diverse skills and backgrounds work in unison, guided by our vision, mission and values under the leadership of our managing director.' },
      { title: 'Freedom to Make Decisions', text: 'We empower decision making at every level, guided by these values, so we consistently meet customer expectations.' },
    ],
    vision:
      'To be an integrated player in clean room solutions, offering world-class products and services, and to stand among the leading global suppliers of turnkey clean rooms.',
    mission: 'Satisfied customers through quality products and services, safe work practices and adherence to timelines.',
  };

  const categories = [
    { id: 'doors', name: 'Metal Doors', blurb: 'Scientific, fire-rated, commercial, decorative and shaft doors.' },
    { id: 'rooms', name: 'Clean Rooms & HVAC', blurb: 'Controlled environments, air handling and modular theatres.' },
    { id: 'airflow', name: 'Laminar Airflow', blurb: 'HEPA-filtered LAF units, dust collection and air scrubbing.' },
    { id: 'transfer', name: 'Material Transfer', blurb: 'Pass boxes and booths that protect clean zones.' },
    { id: 'furniture', name: 'Clean Room Furniture', blurb: 'Stainless and GI tables, benches, scrub stations, cubicles.' },
  ];

  const img = (p) => IMAGE_BASE + 'img/products/' + p;

  const products = [
    {
      slug: 'metal-doors',
      name: 'Metal Doors',
      category: 'doors',
      model: 'door',
      modelOptions: { style: 'scientific' },
      modelStyles: [
        ['Scientific', { style: 'scientific' }],
        ['Fire', { style: 'fire' }],
        ['General', { style: 'general' }],
        ['Decorative', { style: 'decorative' }],
        ['Shaft / Firehose', { style: 'shaft' }],
        ['Clean room', { style: 'cleanroom' }],
      ],
      image: img('home-sa-doors.jpg'),
      short: 'High-performance steel doorsets for laboratories, research facilities and controlled environments.',
      summary: [
        'A specialised steel entryway for spaces that need precise environmental control. Premium materials give strong insulation, sound reduction and security, protecting sensitive work and equipment.',
        'Options include airtight seals and reinforced frames, so every doorset can be configured to the room it serves, with a clean, modern finish.',
      ],
      variants: [
        { name: 'Scientific Doors', image: img('scientific-doors.jpg'), text: 'Flush, easy-clean doorsets for labs and clean rooms, with airtight seals, reinforced frames and vision panels.' },
        { name: 'Fire Doors', image: img('Fire-Doors.jpg'), text: 'Built from fire-resistant materials to withstand intense heat and hold back flames, smoke and toxic gases. Advanced sealing and locking give dependable protection for commercial, industrial and residential buildings.' },
        { name: 'General / Commercial Doors', image: img('General-door.jpg'), text: 'Durable doors for offices, retail and public spaces that handle heavy daily traffic. Available hinged, sliding or automatic, with good security, energy efficiency and easy maintenance.' },
        { name: 'Decorative Doors', image: img('Decorative-door.jpg'), text: 'Statement doors with detailed designs and premium finishes in classic, modern or custom styles, combining visual appeal with strength, security and insulation.' },
        { name: 'Shaft Doors / Firehose Doors', image: img('Shaft-Door.jpg'), text: 'Fire-resistant access doors for utility shafts and fire hose cabinets. They help contain smoke and fire, lock securely, and come in sizes to meet building code requirements.' },
      ],
      gallery: Array.from({ length: 10 }, (_, i) => img('metal-doors-' + (i + 1) + '.jpg')),
    },
    {
      slug: 'clean-rooms',
      name: 'Clean Rooms',
      category: 'rooms',
      model: 'cleanroom',
      image: img('clean-rooms.jpg'),
      short: 'Controlled environments engineered to minimise particles and keep processes sterile.',
      summary: [
        'A clean room is a tightly controlled space that keeps contamination to a minimum. It is essential wherever a single particle can compromise a product, from pharmaceuticals to semiconductors.',
        'Air is passed through HEPA filters that capture 99.97% of particles of 0.3 microns and larger. Airflow patterns, temperature and humidity are designed together, and positive pressure pushes contaminants out rather than drawing them in.',
      ],
      specs: [
        { label: 'Filtration', value: 'HEPA, 99.97% @ 0.3 µm' },
        { label: 'Pressure', value: 'Positive, zoned cascade' },
        { label: 'Control', value: 'Temperature & humidity' },
      ],
      sections: [
        {
          title: 'Applications',
          items: [
            ['Electronics', 'Semiconductors, microchips and other electronic components.'],
            ['Pharmaceuticals', 'Sterile medicines, vaccines and medical devices.'],
            ['Biotechnology', 'Research and development of biological products.'],
            ['Aerospace', 'Assembly of sensitive aerospace components.'],
            ['Optics', 'Precision optical lenses and mirrors.'],
            ['Food and Beverage', 'Sterile food and beverage production.'],
            ['Research', 'Scientific work that needs a controlled environment.'],
          ],
        },
      ],
    },
    {
      slug: 'hvac-systems',
      name: 'HVAC Systems',
      category: 'rooms',
      model: 'hvac',
      image: img('hvac-systems.jpg'),
      short: 'Heating, ventilation and air conditioning that controls temperature, humidity and air quality.',
      summary: [
        'HVAC systems control the temperature, humidity and air quality inside a building. In clean rooms and hospitals they are the foundation of a comfortable, healthy and compliant environment.',
        'We help you choose and configure the right system for your space and process.',
      ],
      sections: [
        {
          title: 'Types of HVAC systems',
          items: [
            ['Central HVAC Systems', 'Plant in a central mechanical room distributes conditioned air through ductwork.'],
            ['Split Systems', 'An outdoor and an indoor unit linked by refrigerant lines, suited to smaller buildings and rooms.'],
            ['Mini-Split Systems', 'Like split systems, sized for individual rooms or zones.'],
          ],
        },
        {
          title: 'Benefits',
          items: [
            ['Improved Comfort', 'Stable temperature and humidity all day.'],
            ['Energy Efficiency', 'Modern equipment reduces energy use and running costs.'],
            ['Improved Air Quality', 'Pollutants and allergens are filtered out.'],
            ['Increased Productivity', 'A healthy environment keeps teams comfortable and productive.'],
          ],
        },
      ],
    },
    {
      slug: 'ahu-systems',
      name: 'AHU Systems',
      category: 'rooms',
      model: 'ahu',
      modelOptions: { decks: 2 },
      modelStyles: [
        ['Double decker', { decks: 2 }],
        ['Single decker', { decks: 1 }],
      ],
      image: img('ahu-systems.jpg'),
      short: 'Air handling units for efficient ventilation, heating and cooling of large spaces.',
      summary: [
        'Our Air Handling Units move large volumes of air while holding temperature and humidity precisely. Advanced filtration and energy-efficient components deliver clean air at lower operating cost.',
        'Units come in a range of sizes and configurations and are customised to your building’s HVAC system for reliable, long-term performance.',
      ],
      variants: [
        { name: 'Single Decker AHU', image: img('single-decker-ahu.jpg'), text: 'Filters, fans and coils integrated in one compact compartment. Ideal where space is limited but performance can’t be, with easy installation and maintenance.' },
        { name: 'Double Decker AHU', image: img('double-decker-ahu.jpg'), text: 'Two stacked compartments split filters, fans, coils and humidifiers into upper and lower sections for greater capacity, better airflow and tighter temperature and humidity control.' },
      ],
    },
    {
      slug: 'modular-ot',
      name: 'Modular Operation Theater',
      category: 'rooms',
      model: 'ot',
      image: img('modular-operation-theater.jpg'),
      short: 'Prefabricated, fully equipped operation theatres that install fast and adapt as you grow.',
      summary: [
        'Modular operation theatres are built off-site under controlled conditions, then transported and assembled on-site. They give healthcare facilities a flexible, cost-effective route to high-quality surgical suites.',
        'Rapid deployment, customisation and consistent build quality make them a strong choice for hospitals and clinics expanding their surgical capability.',
      ],
      sections: [
        {
          title: 'Key benefits',
          items: [
            ['Rapid Deployment', 'Quick installation means less downtime and earlier surgeries.'],
            ['Flexibility', 'Reconfigure or expand as demand changes.'],
            ['Cost-Effective', 'Shorter lead times and lower labour costs than conventional builds.'],
            ['High Quality', 'Built to the same stringent standards as traditional theatres.'],
            ['Customization', 'Configured for cardiology, orthopaedics, general surgery and more.'],
          ],
        },
        {
          title: 'Applications',
          items: [
            ['New Hospital Construction', 'An efficient way to build new hospitals or add capacity.'],
            ['Renovations and Expansions', 'Upgrade surgical suites without disrupting patient care.'],
            ['Temporary Surgical Facilities', 'Disaster relief and short-term demand.'],
          ],
        },
      ],
    },
    {
      slug: 'gi-work-table',
      name: 'GI Work Table',
      category: 'furniture',
      model: 'pedestal',
      image: img('gi-work-table.jpg'),
      short: 'Sturdy galvanised-iron tables with a hygienic surface for medical and lab tasks.',
      summary: [
        'Made from galvanised iron, these tables are durable, corrosion resistant and easy to maintain, giving healthcare staff a solid, hygienic work surface.',
      ],
      sections: [
        {
          title: 'Key features',
          items: [
            ['Durability', 'High-quality galvanised iron resists rust and corrosion.'],
            ['Versatility', 'Suits operating rooms, emergency departments and patient care units.'],
            ['Hygienic Design', 'Smooth, seamless surfaces that are simple to clean and disinfect.'],
            ['Adjustable Height', 'Height options available for different tasks and users.'],
            ['Load-Bearing Capacity', 'Stable under heavy loads and demanding use.'],
          ],
        },
        {
          title: 'Applications',
          items: [
            ['Surgical Procedures', 'Holding instruments, supplies and charts in theatre.'],
            ['Patient Care', 'Medication rounds and bedside procedures.'],
            ['Emergency Departments', 'Triage, treatment and resuscitation.'],
            ['Laboratories', 'Experiments, sample preparation and analysis.'],
          ],
        },
      ],
    },
    {
      slug: 'mobile-laf',
      name: 'Mobile LAF',
      category: 'airflow',
      model: 'mobilelaf',
      image: img('mobile-laf.jpg'),
      short: 'Portable laminar airflow units that bring a clean zone wherever you need it.',
      summary: [
        'Mobile laminar air flow units create the same clean, controlled zone as a fixed LAF, on castors. They are ideal where a permanent installation is impractical or not cost-effective.',
      ],
      specs: [
        { label: 'Filtration', value: 'HEPA' },
        { label: 'Mounting', value: 'Castor wheels' },
        { label: 'Build', value: 'Custom size & airflow' },
      ],
      sections: [
        {
          title: 'Key features',
          items: [
            ['Portability', 'Easy to move and set up for temporary or on-site work.'],
            ['Efficiency', 'HEPA filters remove airborne contaminants for a sterile zone.'],
            ['Flexibility', 'Works in labs, clean rooms and manufacturing areas.'],
            ['Customization', 'Size, airflow rate and filtration built to specification.'],
          ],
        },
        {
          title: 'Applications',
          items: [
            ['Pharmaceutical Manufacturing', 'Sterile product manufacturing.'],
            ['Biotechnology Research', 'Controlled space for sensitive research.'],
            ['Electronics Assembly', 'Clean workspace for delicate components.'],
            ['Food Processing', 'Hygienic food production.'],
            ['Temporary Clean Rooms', 'Short-term projects and temporary set-ups.'],
          ],
        },
      ],
    },
    {
      slug: 'dispensing-booth',
      name: 'Dispensing Booth',
      category: 'transfer',
      model: 'booth',
      image: img('dispensing-booth.jpg'),
      short: 'Enclosed, controlled workstations for safe and accurate dispensing.',
      summary: [
        'Dispensing booths are enclosed structures that give operators a controlled environment for dispensing pharmaceuticals and other materials safely and accurately.',
        'They reduce errors, protect product integrity and improve throughput in hospitals, pharmacies and production facilities.',
      ],
      sections: [
        {
          title: 'Key features',
          items: [
            ['Controlled Environment', 'Prevents contamination and protects product integrity.'],
            ['Security', 'Optional access control, cameras and alarms.'],
            ['Efficiency', 'A streamlined process with fewer errors.'],
            ['Ergonomics', 'A comfortable, efficient workspace for operators.'],
            ['Customization', 'Size, layout and features to your requirements.'],
          ],
        },
        {
          title: 'Benefits',
          items: [
            ['Improved Accuracy', 'The right product, every time.'],
            ['Enhanced Security', 'Protection against theft and unauthorised access.'],
            ['Increased Efficiency', 'Shorter waits and smoother workflow.'],
            ['Improved Hygiene', 'A clean, hygienic dispensing area.'],
          ],
        },
        {
          title: 'Applications',
          items: [
            ['Pharmacies', 'Dispensing prescription medicines.'],
            ['Hospitals', 'Medicines, medical supplies and food items.'],
            ['Retail Stores', 'Controlled dispensing of packaged goods.'],
            ['Manufacturing Facilities', 'Components and raw materials for production.'],
          ],
        },
      ],
    },
    {
      slug: 'crossover-bench',
      name: 'Cross Over Bench with Dustbin',
      category: 'furniture',
      model: 'bench',
      image: img('crossover-bench-with-dustbin.jpg'),
      short: 'Change-room crossover benches with an integrated dustbin for hygienic disposal.',
      summary: [
        'A versatile, modern bench with a distinctive cross-over design that combines comfortable seating with a built-in dustbin for clean, convenient waste disposal.',
      ],
      sections: [
        {
          title: 'Key features',
          items: [
            ['Stylish Design', 'A clean, modern cross-over form that suits any space.'],
            ['Durability', 'Quality materials that resist wear and tear.'],
            ['Comfort', 'Ergonomic seating for all users.'],
            ['Functionality', 'Integrated dustbin keeps the area tidy.'],
            ['Versatility', 'Change rooms, public spaces, campuses and commercial areas.'],
          ],
        },
        {
          title: 'Applications',
          items: [
            ['Parks and Public Spaces', 'Seating plus waste disposal for visitors.'],
            ['Educational Institutions', 'Functional spaces for students and staff.'],
            ['Commercial Areas', 'Malls, shopping centres and venues.'],
            ['Residential Communities', 'Elegant, practical shared areas.'],
          ],
        },
      ],
    },
    {
      slug: 'portable-dust-collector',
      name: 'Portable Dust Collector',
      category: 'airflow',
      model: 'collector',
      image: img('portable-dust-collector.jpg'),
      short: 'Compact machines that capture airborne dust at the source.',
      summary: [
        'Portable dust collectors capture and filter airborne dust before it spreads through the workplace, protecting both products and people.',
      ],
      sections: [
        {
          title: 'Benefits',
          items: [
            ['Improved Air Quality', 'Lower dust levels and fewer respiratory risks.'],
            ['Increased Productivity', 'A cleaner, healthier place to work.'],
            ['Compliance with Regulations', 'Meets health and safety requirements for dust control.'],
            ['Cost-Effective', 'Minimal installation and maintenance.'],
          ],
        },
        {
          title: 'Types',
          items: [
            ['Cyclone Dust Collectors', 'Centrifugal force separates dust from the air stream.'],
            ['Cartridge Dust Collectors', 'A series of filter cartridges traps particles.'],
            ['Bag Filter Dust Collectors', 'Fabric bags filter out dust.'],
          ],
        },
      ],
    },
    {
      slug: 'work-table-ss',
      name: 'Work Table SS',
      category: 'furniture',
      model: 'table',
      image: img('work-table-ss.jpg'),
      short: 'Stainless steel work tables for healthcare, food processing and laboratories.',
      summary: [
        'Stainless steel tables are durable, corrosion resistant and easy to keep clean, making them the standard for demanding hygienic environments.',
      ],
      sections: [
        {
          title: 'Key features',
          items: [
            ['Durability', 'High-grade stainless steel that resists rust and corrosion.'],
            ['Hygiene', 'Non-porous surfaces that are easy to clean and disinfect.'],
            ['Versatility', 'From operating rooms to food preparation areas.'],
            ['Customization', 'Size, shape and features made to order.'],
          ],
        },
        {
          title: 'Applications',
          items: [
            ['Healthcare', 'Medication preparation, examinations and procedures.'],
            ['Food Processing', 'Preparation, packaging and quality control.'],
            ['Laboratories', 'Experiments, sample analysis and reagent preparation.'],
            ['Industrial Settings', 'Manufacturing plants and workshops.'],
          ],
        },
      ],
    },
    {
      slug: 'wall-mounted-scrubber',
      name: 'Wall Mounted Scrubber',
      subtitle: 'Surgical scrub station',
      category: 'furniture',
      model: 'scrubber',
      image: img('scrubber.jpg'),
      short: 'Stainless steel surgical scrub sink for pre-operative hand washing.',
      summary: [
        'A wall-mounted stainless steel scrub station for surgical and clean room hand washing. A deep, seamless basin, a tall splash-back and elbow- or sensor-operated taps help keep scrubbed hands contamination-free.',
        'A perforated drain tray gives a hygienic resting area, and the whole unit is built to be cleaned and disinfected quickly.',
      ],
      sections: [
        {
          title: 'Key features',
          items: [
            ['Seamless SS Basin', 'Deep stainless steel trough with rounded corners and no dirt traps.'],
            ['High Splash-Back', 'Protects the wall and keeps splashes inside the unit.'],
            ['Hands-Free Taps', 'Elbow-, knee- or sensor-operated gooseneck taps on request.'],
            ['Perforated Drain Tray', 'Hygienic drip area beside the basin.'],
            ['Wall Mounted', 'Keeps the floor clear for easy cleaning.'],
          ],
        },
        {
          title: 'Applications',
          items: [
            ['Operation Theatres', 'Pre-operative surgical hand scrub.'],
            ['Clean Room Gowning', 'Hand washing before entering controlled zones.'],
            ['Laboratories', 'Hygienic wash stations for lab staff.'],
            ['ICUs and Wards', 'Infection control at the point of care.'],
          ],
        },
      ],
    },
    {
      slug: 'dynamic-passbox',
      name: 'Dynamic Pass Box',
      subtitle: 'Non-FLP, two leaf',
      category: 'transfer',
      model: 'passbox',
      modelOptions: { type: 'dynamic' },
      image: img('dynamic-passbox-non-flp-two-leaf.jpg'),
      short: 'Ventilated, interlocked transfer chambers for moving materials between clean zones.',
      summary: [
        'Dynamic pass boxes transfer materials between controlled environments such as clean rooms and laboratories without exposing either side. The two-leaf, non-FLP version is designed for non-flammable materials.',
      ],
      sections: [
        {
          title: 'Key features',
          items: [
            ['Two-Leaf Doors', 'One door on each side of the chamber.'],
            ['Interlocking Mechanism', 'Both doors can never be open at once.'],
            ['Ventilation System', 'Filtered airflow keeps the chamber clean.'],
            ['Material Transfer Tray', 'Easy loading and unloading.'],
            ['Safety Features', 'Optional alarms, sensors and access control.'],
          ],
        },
        {
          title: 'Benefits',
          items: [
            ['Improved Efficiency', 'Faster transfers with less contamination risk.'],
            ['Enhanced Security', 'Interlocks prevent unauthorised access.'],
            ['Reduced Contamination Risk', 'Minimal exposure to outside air.'],
            ['Versatility', 'Handles a wide range of non-flammable materials.'],
          ],
        },
        {
          title: 'Applications',
          items: [
            ['Pharmaceutical Industry', 'Sterile materials between clean rooms.'],
            ['Biotechnology', 'Biological samples and reagents.'],
            ['Electronics Manufacturing', 'Sensitive components.'],
            ['Food Processing', 'Ingredients and products.'],
          ],
        },
      ],
    },
    {
      slug: 'garment-cubicle',
      name: 'Garment Cubicle',
      category: 'furniture',
      model: 'cubicle',
      image: img('garmentcubic.jpg'),
      short: 'Stainless steel cabinet for storing clean room garments in gowning areas.',
      summary: [
        'A stainless steel storage cabinet for clean room garments. Upper doors with vision panels keep sterile gowns visible yet protected, and a lower compartment stores footwear and accessories.',
        'Built to order in size and configuration, on castors or fixed feet.',
      ],
      sections: [
        {
          title: 'Key features',
          items: [
            ['Stainless Steel Build', 'Corrosion resistant and easy to disinfect.'],
            ['Vision Panel Doors', 'See the contents without opening the cabinet.'],
            ['Two Compartments', 'Garments above, footwear and accessories below.'],
            ['Custom Sizes', 'Made to fit your gowning room layout.'],
          ],
        },
        {
          title: 'Applications',
          items: [
            ['Gowning Rooms', 'Clean garments ready at the point of entry.'],
            ['Operation Theatres', 'Scrub suits and surgical gowns.'],
            ['Pharma Plants', 'Garment storage for each clean room grade.'],
            ['Laboratories', 'Lab coats and protective wear.'],
          ],
        },
      ],
    },
    {
      slug: 'ot-laf',
      name: 'OT LAF',
      subtitle: 'Operating Theater Laminar Air Flow',
      category: 'airflow',
      model: 'otlaf',
      image: img('ot-laf.jpg'),
      short: 'HEPA-filtered laminar airflow that keeps the surgical field sterile.',
      summary: [
        'OT LAF systems maintain a sterile environment in surgical suites by delivering HEPA-filtered air over the operating field.',
        'A well-specified OT LAF reduces infection risk, supports better patient outcomes and helps facilities comply with healthcare standards.',
      ],
      sections: [
        {
          title: 'Key components',
          items: [
            ['HEPA Filters', 'Remove 99.97% of airborne particles, including bacteria and dust.'],
            ['Blower', 'Draws air in and drives it through the filters.'],
            ['Plenum', 'Distributes filtered air evenly.'],
            ['Diffusers', 'Spread air uniformly across the surgical field.'],
          ],
        },
        {
          title: 'Benefits',
          items: [
            ['Reduced Infection Rates', 'Lower risk for patients and staff.'],
            ['Improved Patient Outcomes', 'Fewer complications.'],
            ['Compliance with Regulations', 'Meets healthcare standards.'],
            ['Enhanced Efficiency', 'A cleaner theatre runs smoother.'],
          ],
        },
        {
          title: 'Types',
          items: [
            ['Vertical Laminar Flow', 'Air moves from ceiling to floor, pushing contaminants away from the field.'],
            ['Horizontal Laminar Flow', 'Unidirectional air from back to front of the room.'],
            ['Combined Laminar Flow', 'Vertical and horizontal flow for maximum control.'],
          ],
        },
      ],
    },
    {
      slug: 'reverse-laf',
      name: 'Reverse LAF',
      subtitle: 'Reverse laminar air flow',
      category: 'airflow',
      model: 'reverselaf',
      image: img('reverse-laf-or-laminer.jpg'),
      short: 'Unidirectional ceiling-to-floor airflow for sterile work areas.',
      summary: [
        'Reverse LAF systems direct a continuous, unidirectional flow of filtered air from ceiling to floor, preventing contamination and keeping the work area sterile. They are essential in pharmaceuticals, biotechnology and electronics.',
      ],
      sections: [
        {
          title: 'Key components',
          items: [
            ['HEPA Filters', 'Remove dust, bacteria and other particles from incoming air.'],
            ['Blower', 'Moves air through the filters.'],
            ['Plenum', 'Evenly distributes filtered air.'],
            ['Diffusers', 'Spread air across the work surface.'],
          ],
        },
        {
          title: 'Benefits',
          items: [
            ['Clean Environment', 'Contaminants are kept out of the workspace.'],
            ['Product Protection', 'Sensitive products and materials stay clean.'],
            ['Improved Efficiency', 'Cleaner processes run better.'],
            ['Compliance with Regulations', 'Supports clean room compliance.'],
          ],
        },
        {
          title: 'Applications',
          items: [
            ['Pharmaceutical Manufacturing', 'Sterile drugs and medical devices.'],
            ['Biotechnology Research', 'Sterile research environments.'],
            ['Electronics Manufacturing', 'Sensitive component assembly.'],
            ['Food Processing', 'Clean, sterile food processing.'],
          ],
        },
      ],
    },
    {
      slug: 'foot-operated-scrubber',
      name: 'Foot Operated Scrubber',
      subtitle: 'Hands-free scrub station',
      category: 'furniture',
      model: 'footscrubber',
      image: img('foot-operating-scrubber.jpg'),
      short: 'Floor-standing SS scrub sink with foot-pedal water control.',
      summary: [
        'A floor-standing stainless steel scrub station where water is controlled by foot pedals, so users never touch a tap. It removes a key contact point and helps prevent cross-contamination.',
        'The enclosed base conceals plumbing behind a removable service panel.',
      ],
      sections: [
        {
          title: 'Key features',
          items: [
            ['Hands-Free Operation', 'Foot pedals control the water, with no touch points at the sink.'],
            ['Enclosed SS Cabinet', 'Plumbing hidden behind a removable service panel.'],
            ['Durability', 'Robust stainless steel construction and quality fittings.'],
            ['Easy to Clean', 'Smooth surfaces that are quick to disinfect.'],
          ],
        },
        {
          title: 'Benefits',
          items: [
            ['Improved Hygiene', 'Limits the spread of germs and bacteria.'],
            ['Reduced Fatigue', 'Comfortable, natural operation for long shifts.'],
            ['Compliance', 'Supports infection control protocols in OTs and clean rooms.'],
            ['Versatility', 'Suits theatres, gowning rooms, labs and wards.'],
          ],
        },
      ],
    },
    {
      slug: 'dynamic-three-leaf-passbox',
      name: 'Dynamic Three Leaf Pass Box',
      subtitle: 'FLP, for flammable liquids',
      category: 'transfer',
      model: 'passbox3',
      image: img('dynamic-three-leaf-passbooks-flp.jpg'),
      short: 'Flame-proof, three-door interlocked chambers for transferring flammable liquids.',
      summary: [
        'Three interlocking doors and a flame-proof build make these pass boxes the safe way to move flammable liquids between controlled environments while staying compliant.',
      ],
      sections: [
        {
          title: 'Key features',
          items: [
            ['Three-Leaf Doors', 'Three interlocked doors that never open together.'],
            ['Ventilation System', 'Prevents flammable vapours from building up.'],
            ['Explosion Proof Design', 'Mitigates the risk of ignition.'],
            ['Material Transfer Tray', 'Easy loading and unloading.'],
            ['Safety Features', 'Optional alarms, sensors and access control.'],
          ],
        },
        {
          title: 'Benefits',
          items: [
            ['Enhanced Safety', 'Three-leaf, flame-proof protection.'],
            ['Improved Efficiency', 'Streamlined, lower-risk transfers.'],
            ['Reduced Contamination Risk', 'Minimal exposure to outside air.'],
            ['Versatility', 'Handles a wide range of flammable liquids.'],
          ],
        },
        {
          title: 'Applications',
          items: [
            ['Chemical Manufacturing', 'Solvents and reagents.'],
            ['Paint and Coatings Industry', 'Paints, coatings and solvents.'],
            ['Petroleum Industry', 'Fuels and lubricants.'],
            ['Research Laboratories', 'Flammable chemicals for experiments.'],
          ],
        },
      ],
    },
    {
      slug: 'static-passbox',
      name: 'Static Pass Box',
      category: 'transfer',
      model: 'passbox',
      modelOptions: { type: 'static' },
      image: img('static-passbox.jpg'),
      short: 'Simple, reliable interlocked chambers for material transfer between zones.',
      summary: [
        'Static pass boxes transfer materials between controlled environments. Without a ventilation system they are simpler and more economical than dynamic pass boxes, ideal where a controlled atmosphere inside the chamber isn’t required.',
      ],
      sections: [
        {
          title: 'Key features',
          items: [
            ['Two Doors', 'One on each side of the chamber.'],
            ['Interlocking Mechanism', 'Both doors can never be open at once.'],
            ['Material Transfer Tray', 'Easy loading and unloading.'],
            ['Simple Design', 'Easy to use and maintain.'],
          ],
        },
        {
          title: 'Benefits',
          items: [
            ['Cost-Effective', 'More affordable than dynamic models.'],
            ['Easy to Use', 'Intuitive for every operator.'],
            ['Reliable', 'Durable for long-term performance.'],
            ['Versatile', 'Clean rooms, labs and production facilities.'],
          ],
        },
        {
          title: 'Applications',
          items: [
            ['Clean Rooms', 'Between clean room zones.'],
            ['Laboratories', 'Samples and reagents.'],
            ['Manufacturing Facilities', 'Between production lines.'],
            ['Pharmaceutical Industry', 'Sterile materials and products.'],
          ],
        },
      ],
    },
  ];

  window.SAD = { company, announcement, home, about, categories, products, IMAGE_BASE };
})();
