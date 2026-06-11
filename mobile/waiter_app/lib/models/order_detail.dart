class OrderDetail {
  final String id;
  final String orderNumber;
  final String status;
  final String source; // waiter | self_order
  final TableRef? table;
  final double subtotal;
  final double discountAmount;
  final double cgstAmount;
  final double sgstAmount;
  final double total;
  final String? notes;
  final int kotCount;
  final List<OrderItem> items;

  const OrderDetail({
    required this.id,
    required this.orderNumber,
    required this.status,
    required this.source,
    required this.table,
    required this.subtotal,
    required this.discountAmount,
    required this.cgstAmount,
    required this.sgstAmount,
    required this.total,
    required this.notes,
    required this.kotCount,
    required this.items,
  });

  factory OrderDetail.fromJson(Map<String, dynamic> json) => OrderDetail(
    id: json['_id'] as String,
    orderNumber: json['order_number'] as String? ?? '',
    status: json['status'] as String? ?? 'pending',
    source: json['source'] as String? ?? 'waiter',
    table: json['table'] == null
        ? null
        : TableRef.fromJson(json['table'] as Map<String, dynamic>),
    subtotal: (json['subtotal'] as num?)?.toDouble() ?? 0,
    discountAmount: (json['discount_amount'] as num?)?.toDouble() ?? 0,
    cgstAmount: (json['cgst_amount'] as num?)?.toDouble() ?? 0,
    sgstAmount: (json['sgst_amount'] as num?)?.toDouble() ?? 0,
    total: (json['total'] as num?)?.toDouble() ?? 0,
    notes: json['notes'] as String?,
    kotCount: (json['kot_count'] as num?)?.toInt() ?? 0,
    items: (json['items'] as List<dynamic>? ?? const [])
        .map((e) => OrderItem.fromJson(e as Map<String, dynamic>))
        .toList(growable: false),
  );

  /// Items still on the cart that haven't been printed yet.
  Iterable<OrderItem> get unsentItems => items.where((i) => i.kotBatch == null);

  bool get hasUnsentItems => unsentItems.isNotEmpty;

  bool get isClosed => status == 'paid' || status == 'cancelled';
}

class TableRef {
  final String id;
  final String tableNumber;
  final int capacity;
  const TableRef({
    required this.id,
    required this.tableNumber,
    required this.capacity,
  });
  factory TableRef.fromJson(Map<String, dynamic> json) => TableRef(
    id: json['_id'] as String,
    tableNumber: json['table_number'] as String? ?? '?',
    capacity: (json['capacity'] as num?)?.toInt() ?? 0,
  );
}

class OrderItem {
  final String id;
  final String menuItemId;
  final String name;
  final double price;
  final int quantity;
  final String? notes;
  final int? kotBatch; // null when not yet sent
  final String source; // waiter | self_order

  const OrderItem({
    required this.id,
    required this.menuItemId,
    required this.name,
    required this.price,
    required this.quantity,
    required this.notes,
    required this.kotBatch,
    required this.source,
  });

  factory OrderItem.fromJson(Map<String, dynamic> json) => OrderItem(
    id: json['_id'] as String,
    menuItemId: json['menu_item_id'] as String,
    name: json['name'] as String? ?? '',
    price: (json['price'] as num?)?.toDouble() ?? 0,
    quantity: (json['quantity'] as num?)?.toInt() ?? 0,
    notes: json['notes'] as String?,
    kotBatch: (json['kot_batch'] as num?)?.toInt(),
    source: json['source'] as String? ?? 'waiter',
  );

  bool get isSent => kotBatch != null;
  bool get fromSelfOrder => source == 'self_order';
}
