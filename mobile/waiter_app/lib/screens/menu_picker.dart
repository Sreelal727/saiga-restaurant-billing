import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../models/menu.dart';
import '../state/cart.dart';

/// Bottom-sheet menu picker. Shows categories as a sticky strip and items in
/// a scrolling list. Tap to add → updates the local cart. The host screen
/// owns the cart and submits it.
class MenuPicker extends StatefulWidget {
  final Cart cart;
  final String currency;
  const MenuPicker({super.key, required this.cart, required this.currency});

  @override
  State<MenuPicker> createState() => _MenuPickerState();
}

class _MenuPickerState extends State<MenuPicker> {
  List<MenuCategory>? _categories;
  String? _activeCategory;
  String _search = '';
  bool _vegOnly = false;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = context.read<ApiClient>();
    try {
      final cats = await api.menu();
      if (!mounted) return;
      setState(() {
        _categories = cats;
        _activeCategory = cats.isNotEmpty ? cats.first.id : null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  List<MenuItem> _filteredItems(MenuCategory cat) {
    final term = _search.trim().toLowerCase();
    return cat.items
        .where((i) {
          if (_vegOnly && !i.isVeg) return false;
          if (term.isEmpty) return true;
          return i.name.toLowerCase().contains(term) ||
              (i.description?.toLowerCase().contains(term) ?? false);
        })
        .toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cart = widget.cart;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
        ),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.85,
          child: Column(
            children: [
              Container(
                width: 40,
                height: 4,
                margin: const EdgeInsets.only(top: 8),
                decoration: BoxDecoration(
                  color: theme.colorScheme.outlineVariant,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Add items',
                        style: theme.textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    FilterChip(
                      label: const Text('Veg only'),
                      selected: _vegOnly,
                      onSelected: (v) => setState(() => _vegOnly = v),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
                child: TextField(
                  decoration: const InputDecoration(
                    hintText: 'Search dishes',
                    prefixIcon: Icon(Icons.search),
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                  onChanged: (v) => setState(() => _search = v),
                ),
              ),
              Expanded(child: _body(theme)),
              _footer(theme, cart),
            ],
          ),
        ),
      ),
    );
  }

  Widget _body(ThemeData theme) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Failed to load menu', style: theme.textTheme.titleMedium),
              const SizedBox(height: 4),
              Text('$_error', style: theme.textTheme.bodySmall),
              const SizedBox(height: 12),
              FilledButton.tonal(onPressed: _load, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    final cats = _categories ?? const [];
    if (cats.isEmpty) {
      return const Center(child: Text('No menu items yet.'));
    }
    return Column(
      children: [
        SizedBox(
          height: 44,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            itemCount: cats.length,
            separatorBuilder: (_, _) => const SizedBox(width: 8),
            itemBuilder: (ctx, i) {
              final cat = cats[i];
              final isActive = cat.id == _activeCategory;
              return ChoiceChip(
                label: Text(cat.name),
                selected: isActive,
                onSelected: (_) => setState(() => _activeCategory = cat.id),
              );
            },
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: ListView(
            children: cats
                .where((c) {
                  if (_search.trim().isEmpty) return c.id == _activeCategory;
                  return true;
                })
                .expand((cat) {
                  final items = _filteredItems(cat);
                  if (items.isEmpty) return const <Widget>[];
                  return [
                    if (_search.trim().isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                        child: Text(
                          cat.name,
                          style: theme.textTheme.titleSmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    for (final item in items) _itemTile(theme, item),
                  ];
                })
                .toList(growable: false),
          ),
        ),
      ],
    );
  }

  Widget _itemTile(ThemeData theme, MenuItem item) {
    final inCart = widget.cart.lines.firstWhere(
      (l) => l.item.id == item.id,
      orElse: () => CartLine(item: item, quantity: 0),
    );
    final qty = inCart.quantity;
    final outOfStock = !item.inStock;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: outOfStock
              ? null
              : () => setState(() => widget.cart.add(item)),
          child: Padding(
            padding: const EdgeInsets.all(8),
            child: Row(
              children: [
                Container(
                  width: 14,
                  height: 14,
                  margin: const EdgeInsets.only(right: 10),
                  decoration: BoxDecoration(
                    border: Border.all(
                      color: item.isVeg ? Colors.green : Colors.redAccent,
                      width: 1.5,
                    ),
                    borderRadius: BorderRadius.circular(2),
                  ),
                  child: Center(
                    child: Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(
                        color: item.isVeg ? Colors.green : Colors.redAccent,
                        shape: BoxShape.circle,
                      ),
                    ),
                  ),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.name,
                        style: theme.textTheme.bodyLarge?.copyWith(
                          fontWeight: FontWeight.w500,
                          color: outOfStock ? theme.colorScheme.outline : null,
                        ),
                      ),
                      if (item.description != null)
                        Text(
                          item.description!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      Row(
                        children: [
                          Text(
                            '${widget.currency}${item.price.toStringAsFixed(2)}',
                            style: theme.textTheme.bodyMedium?.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          if (outOfStock) ...[
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 1,
                              ),
                              decoration: BoxDecoration(
                                color: theme.colorScheme.errorContainer,
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: Text(
                                'Out',
                                style: theme.textTheme.labelSmall?.copyWith(
                                  color: theme.colorScheme.onErrorContainer,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
                if (qty == 0)
                  IconButton.filledTonal(
                    onPressed: outOfStock
                        ? null
                        : () => setState(() => widget.cart.add(item)),
                    icon: const Icon(Icons.add),
                  )
                else
                  Row(
                    children: [
                      IconButton.outlined(
                        onPressed: () => setState(
                          () => widget.cart.setQuantity(item.id, qty - 1),
                        ),
                        icon: const Icon(Icons.remove),
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        child: Text('$qty', style: theme.textTheme.titleMedium),
                      ),
                      IconButton.filled(
                        onPressed: () => setState(
                          () => widget.cart.setQuantity(item.id, qty + 1),
                        ),
                        icon: const Icon(Icons.add),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _footer(ThemeData theme, Cart cart) {
    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(
          top: BorderSide(color: theme.colorScheme.outlineVariant),
        ),
      ),
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${cart.totalQty} items',
                  style: theme.textTheme.labelLarge,
                ),
                Text(
                  '${widget.currency}${cart.subtotal.toStringAsFixed(2)}',
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          FilledButton.icon(
            onPressed: cart.isEmpty
                ? null
                : () => Navigator.of(context).pop(true),
            icon: const Icon(Icons.check_circle),
            label: const Text('Add to order'),
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
            ),
          ),
        ],
      ),
    );
  }
}
