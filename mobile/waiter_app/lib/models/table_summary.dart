/// One row in the home screen's tables grid. `order` is null when the table
/// is free or its order has already been paid/cancelled.
class TableSummary {
  final String id;
  final String tableNumber;
  final int capacity;
  final String status; // available | occupied | reserved
  final String? currentOrderId;
  final OrderSummary? order;
  final int openCallCount;

  const TableSummary({
    required this.id,
    required this.tableNumber,
    required this.capacity,
    required this.status,
    required this.currentOrderId,
    required this.order,
    required this.openCallCount,
  });

  factory TableSummary.fromJson(Map<String, dynamic> json) => TableSummary(
    id: json['_id'] as String,
    tableNumber: json['table_number'] as String? ?? '?',
    capacity: (json['capacity'] as num?)?.toInt() ?? 0,
    status: json['status'] as String? ?? 'available',
    currentOrderId: json['current_order_id'] as String?,
    order: json['order'] == null
        ? null
        : OrderSummary.fromJson(json['order'] as Map<String, dynamic>),
    openCallCount: (json['open_call_count'] as num?)?.toInt() ?? 0,
  );
}

class OrderSummary {
  final String id;
  final String orderNumber;
  final String status;
  final double total;
  final int itemCount;
  final int pendingKotCount;
  final int selfOrderCount;

  const OrderSummary({
    required this.id,
    required this.orderNumber,
    required this.status,
    required this.total,
    required this.itemCount,
    required this.pendingKotCount,
    required this.selfOrderCount,
  });

  factory OrderSummary.fromJson(Map<String, dynamic> json) => OrderSummary(
    id: json['_id'] as String,
    orderNumber: json['order_number'] as String? ?? '',
    status: json['status'] as String? ?? 'pending',
    total: (json['total'] as num?)?.toDouble() ?? 0,
    itemCount: (json['item_count'] as num?)?.toInt() ?? 0,
    pendingKotCount: (json['pending_kot_count'] as num?)?.toInt() ?? 0,
    selfOrderCount: (json['self_order_count'] as num?)?.toInt() ?? 0,
  );

  bool get hasUnsentItems => pendingKotCount > 0;
  bool get hasSelfOrders => selfOrderCount > 0;
}

class Settings {
  final String restaurantName;
  final String currency;
  final double cgstRate;
  final double sgstRate;

  const Settings({
    required this.restaurantName,
    required this.currency,
    required this.cgstRate,
    required this.sgstRate,
  });

  factory Settings.fromJson(Map<String, dynamic> json) => Settings(
    restaurantName: json['restaurant_name'] as String? ?? 'Restaurant',
    currency: json['currency'] as String? ?? '₹',
    cgstRate: (json['cgst_rate'] as num?)?.toDouble() ?? 0,
    sgstRate: (json['sgst_rate'] as num?)?.toDouble() ?? 0,
  );
}

class HomePayload {
  final List<TableSummary> tables;
  final Settings settings;
  const HomePayload({required this.tables, required this.settings});

  factory HomePayload.fromJson(Map<String, dynamic> json) => HomePayload(
    tables: (json['tables'] as List<dynamic>? ?? const [])
        .map((e) => TableSummary.fromJson(e as Map<String, dynamic>))
        .toList(growable: false),
    settings: Settings.fromJson(
      (json['settings'] as Map<String, dynamic>?) ?? const {},
    ),
  );
}
