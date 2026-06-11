class MenuCategory {
  final String id;
  final String name;
  final int displayOrder;
  final List<MenuItem> items;

  const MenuCategory({
    required this.id,
    required this.name,
    required this.displayOrder,
    required this.items,
  });

  factory MenuCategory.fromJson(Map<String, dynamic> json) => MenuCategory(
    id: json['_id'] as String,
    name: json['name'] as String? ?? '',
    displayOrder: (json['display_order'] as num?)?.toInt() ?? 0,
    items: (json['items'] as List<dynamic>? ?? const [])
        .map((e) => MenuItem.fromJson(e as Map<String, dynamic>))
        .toList(growable: false),
  );
}

class MenuItem {
  final String id;
  final String categoryId;
  final String name;
  final String? description;
  final double price;
  final bool isVeg;
  final bool hasInventory;
  final double? stock;
  final String? imageUrl;

  const MenuItem({
    required this.id,
    required this.categoryId,
    required this.name,
    required this.description,
    required this.price,
    required this.isVeg,
    required this.hasInventory,
    required this.stock,
    required this.imageUrl,
  });

  factory MenuItem.fromJson(Map<String, dynamic> json) => MenuItem(
    id: json['_id'] as String,
    categoryId: json['category_id'] as String,
    name: json['name'] as String? ?? '',
    description: json['description'] as String?,
    price: (json['price'] as num?)?.toDouble() ?? 0,
    isVeg: json['is_veg'] as bool? ?? false,
    hasInventory: json['has_inventory'] as bool? ?? false,
    stock: (json['stock'] as num?)?.toDouble(),
    imageUrl: json['image_url'] as String?,
  );

  bool get inStock {
    if (!hasInventory) return true;
    if (stock == null) return true;
    return stock! > 0;
  }
}
