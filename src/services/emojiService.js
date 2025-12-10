/**
 * Servicio para asignar emojis automáticamente a productos basado en su nombre y descripción
 */

/**
 * Obtiene un emoji apropiado para un producto basado en su nombre y descripción
 * @param {string} name - Nombre del producto
 * @param {string} description - Descripción del producto (opcional)
 * @returns {string} - Emoji correspondiente
 */
export function getProductEmoji(name = '', description = '') {
  const searchText = `${name} ${description}`.toLowerCase();
  
  // Frutas y Verduras
  if (
    /manzana|apple|plátano|banana|plátano|naranja|orange|limón|lemon|fresa|strawberry|uva|grape|mango|piña|pineapple|sandía|watermelon|melón|melon|kiwi|durazno|peach|pera|pear|aguacate|avocado|tomate|tomato|lechuga|lettuce|cebolla|onion|ajo|garlic|zanahoria|carrot|papa|potato|calabaza|pumpkin|brócoli|broccoli|espinaca|spinach|pepino|cucumber|jitomate/i.test(searchText)
  ) {
    return '🍎'; // Emoji genérico de fruta/verdura
  }
  
  // Frutas específicas
  if (/manzana|apple/i.test(searchText)) return '🍎';
  if (/plátano|banana/i.test(searchText)) return '🍌';
  if (/naranja|orange/i.test(searchText)) return '🍊';
  if (/limón|lemon/i.test(searchText)) return '🍋';
  if (/fresa|strawberry/i.test(searchText)) return '🍓';
  if (/uva|grape/i.test(searchText)) return '🍇';
  if (/mango/i.test(searchText)) return '🥭';
  if (/piña|pineapple/i.test(searchText)) return '🍍';
  if (/sandía|watermelon/i.test(searchText)) return '🍉';
  if (/melón|melon/i.test(searchText)) return '🍈';
  if (/kiwi/i.test(searchText)) return '🥝';
  if (/durazno|peach/i.test(searchText)) return '🍑';
  if (/pera|pear/i.test(searchText)) return '🍐';
  if (/aguacate|avocado/i.test(searchText)) return '🥑';
  
  // Verduras específicas
  if (/tomate|jitomate|tomato/i.test(searchText)) return '🍅';
  if (/lechuga|lettuce/i.test(searchText)) return '🥬';
  if (/cebolla|onion/i.test(searchText)) return '🧅';
  if (/ajo|garlic/i.test(searchText)) return '🧄';
  if (/zanahoria|carrot/i.test(searchText)) return '🥕';
  if (/papa|patata|potato/i.test(searchText)) return '🥔';
  if (/calabaza|pumpkin/i.test(searchText)) return '🎃';
  if (/brócoli|broccoli/i.test(searchText)) return '🥦';
  if (/espinaca|spinach/i.test(searchText)) return '🥬';
  if (/pepino|cucumber/i.test(searchText)) return '🥒';
  if (/maíz|corn/i.test(searchText)) return '🌽';
  if (/chile|pepper/i.test(searchText)) return '🌶️';
  
  // Refrescos y Bebidas
  if (/refresco|soda|cola|coca|pepsi|fanta|sprite|7up|mirinda|crush|squirt|jarrito|boing|del valle|jamaica|horchata|tamarindo|limonada/i.test(searchText)) {
    return '🥤';
  }
  if (/agua|water|ciel|epura|bonafont/i.test(searchText)) return '💧';
  if (/jugo|juice|néctar|nectar/i.test(searchText)) return '🧃';
  if (/cerveza|beer|corona|heineken|tecate|sol|indio/i.test(searchText)) return '🍺';
  if (/café|coffee|nescafé|nescafe/i.test(searchText)) return '☕';
  if (/té|tea/i.test(searchText)) return '🍵';
  if (/leche|milk|liconsa|alpura|santa clara/i.test(searchText)) return '🥛';
  
  // Lácteos
  if (/queso|cheese|quesillo|queso fresco|panela|asadero|manchego|cheddar|gouda/i.test(searchText)) return '🧀';
  if (/yogurt|yogur|yoplait|danone|danonino|activia/i.test(searchText)) return '🥛';
  if (/mantequilla|butter|margarina/i.test(searchText)) return '🧈';
  if (/crema|cream|crema ácida|sour cream/i.test(searchText)) return '🥛';
  if (/huevo|egg|huevos|huevito/i.test(searchText)) return '🥚';
  
  // Sabritas y Botanas
  if (/sabritas|doritos|cheetos|ruffles|fritos|lays|takis|churrumais|rancheritos|paketaxo|chips|papas|papitas|botana|snack/i.test(searchText)) {
    return '🍟';
  }
  if (/cacahuates|peanuts|maní|almendras|almonds|nueces|walnuts|pistaches|pistachios/i.test(searchText)) return '🥜';
  if (/palomitas|popcorn|palomita/i.test(searchText)) return '🍿';
  
  // Galletas y Dulces
  if (/galleta|cookie|oreo|chokis|marías|emilia|principe|gamesa|ricas|chips ahoy|chips deluxe/i.test(searchText)) {
    return '🍪';
  }
  if (/chocolate|chocoroles|brownie|snickers|mars|kit kat|ferrero|kinder/i.test(searchText)) return '🍫';
  if (/dulce|candy|caramelo|gomitas|gummies|skittles|m&m|m&ms|chicles|gum/i.test(searchText)) return '🍬';
  if (/pan|bread|bimbo|tía rosa|wonder|pan dulce|concha|cuernito|donas|donuts/i.test(searchText)) return '🍞';
  if (/pastel|cake|torta|pay|pie|cheesecake/i.test(searchText)) return '🎂';
  
  // Papelería
  if (/lápiz|pencil|lapicero|pen|pluma|bolígrafo|birome/i.test(searchText)) return '✏️';
  if (/cuaderno|notebook|libreta|agenda/i.test(searchText)) return '📔';
  if (/libro|book/i.test(searchText)) return '📚';
  if (/marcador|marker|resaltador|highlighter/i.test(searchText)) return '🖍️';
  if (/goma|eraser|borrador/i.test(searchText)) return '🧹';
  if (/regla|ruler/i.test(searchText)) return '📏';
  if (/tijeras|scissors/i.test(searchText)) return '✂️';
  if (/pegamento|glue|adhesivo/i.test(searchText)) return '🧴';
  if (/cinta|tape|masking|scotch/i.test(searchText)) return '📦';
  if (/folder|carpeta|archivador/i.test(searchText)) return '📁';
  if (/papel|paper|hoja|sheet/i.test(searchText)) return '📄';
  if (/calculadora|calculator/i.test(searchText)) return '🔢';
  if (/grapadora|stapler/i.test(searchText)) return '📎';
  if (/clips|clip|sujetapapeles/i.test(searchText)) return '📎';
  
  // Productos de limpieza
  if (/jabón|soap|detergente|shampoo|champú|pasta|toothpaste|cepillo|brush|toallitas|wipes/i.test(searchText)) {
    return '🧴';
  }
  if (/papel higiénico|toilet paper|toallas|tissues|servilletas|napkins/i.test(searchText)) return '🧻';
  if (/cloro|bleach|desinfectante|disinfectant/i.test(searchText)) return '🧪';
  
  // Productos de cocina
  if (/aceite|oil|mantequilla|butter|sal|salt|azúcar|sugar|harina|flour|arroz|rice|frijol|bean|pasta|spaghetti|macarrones/i.test(searchText)) {
    return '🥘';
  }
  if (/atún|tuna|sardina|sardine|salmón|salmon/i.test(searchText)) return '🐟';
  if (/pollo|chicken|res|beef|cerdo|pork|carne|meat/i.test(searchText)) return '🍗';
  
  // Productos enlatados
  if (/lata|can|enlatado|canned|conserva/i.test(searchText)) return '🥫';
  
  // Productos congelados
  if (/congelado|frozen|helado|ice cream|nieve/i.test(searchText)) return '🍦';
  
  // Productos de panadería
  if (/pan|bread|tortilla|tortillas|tostadas/i.test(searchText)) return '🍞';
  
  // Productos de higiene personal
  if (/desodorante|deodorant|crema|cream|protector|sunscreen/i.test(searchText)) return '🧴';
  
  // Productos para bebés
  if (/bebé|baby|pañal|diaper|formula|fórmula/i.test(searchText)) return '👶';
  
  // Productos de mascotas
  if (/mascota|pet|perro|dog|gato|cat|croquetas|dog food|cat food/i.test(searchText)) return '🐾';
  
  // Productos de cuidado personal
  if (/shampoo|champú|acondicionador|conditioner|gel|gel de baño|body wash/i.test(searchText)) return '🧴';
  
  // Productos de farmacia
  if (/medicina|medicine|medicamento|aspirina|paracetamol|ibuprofeno|vitaminas|vitamins/i.test(searchText)) return '💊';
  
  // Productos de limpieza del hogar
  if (/trapeador|mop|escoba|broom|trapo|rag|esponja|sponge/i.test(searchText)) return '🧹';
  
  // Si no coincide con ninguna categoría, retornar emoji genérico
  return '📦';
}

/**
 * Asigna un emoji a un producto si no tiene icono
 * @param {Object} productData - Datos del producto
 * @returns {string} - Icono del producto (emoji o el existente)
 */
export function assignEmojiToProduct(productData) {
  const { icon, name, description } = productData;
  
  // Si ya tiene icono, mantenerlo
  if (icon && icon.trim() !== '') {
    return icon;
  }
  
  // Asignar emoji basado en nombre y descripción
  return getProductEmoji(name, description);
}

