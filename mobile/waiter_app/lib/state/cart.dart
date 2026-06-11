import '../models/menu.dart';

/// Single line in the in-progress cart on the order screen. Notes are
/// optional and capped server-side. `unitPrice` is captured here for the
/// preview total — the server re-prices on submit.
class CartLine {
  final MenuItem item;
  int quantity;
  String? notes;
  CartLine({required this.item, this.quantity = 1, this.notes});
  double get lineTotal => item.price * quantity;
}

class Cart {
  final Map<String, CartLine> _lines = {};

  List<CartLine> get lines => _lines.values.toList(growable: false);
  bool get isEmpty => _lines.isEmpty;
  bool get isNotEmpty => _lines.isNotEmpty;
  int get totalQty => _lines.values.fold<int>(0, (s, l) => s + l.quantity);
  double get subtotal =>
      _lines.values.fold<double>(0, (s, l) => s + l.lineTotal);

  void add(MenuItem item) {
    final existing = _lines[item.id];
    if (existing != null) {
      existing.quantity += 1;
    } else {
      _lines[item.id] = CartLine(item: item);
    }
  }

  void setQuantity(String menuItemId, int qty) {
    final existing = _lines[menuItemId];
    if (existing == null) return;
    if (qty <= 0) {
      _lines.remove(menuItemId);
    } else {
      existing.quantity = qty;
    }
  }

  void setNotes(String menuItemId, String? notes) {
    final existing = _lines[menuItemId];
    if (existing == null) return;
    existing.notes = notes;
  }

  void remove(String menuItemId) => _lines.remove(menuItemId);
  void clear() => _lines.clear();
}
