import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../models/order_detail.dart';
import '../state/auth_state.dart';
import '../state/cart.dart';
import 'menu_picker.dart';

/// One screen handles two states: brand-new table (no orderId yet) and existing
/// order (orderId provided, polled every few seconds). The cart at the top is
/// the waiter's in-progress addition that hasn't been submitted yet.
class OrderScreen extends StatefulWidget {
  final String tableId;
  final String tableNumber;
  final String? initialOrderId;

  const OrderScreen({
    super.key,
    required this.tableId,
    required this.tableNumber,
    this.initialOrderId,
  });

  @override
  State<OrderScreen> createState() => _OrderScreenState();
}

class _OrderScreenState extends State<OrderScreen> {
  String? _orderId;
  OrderDetail? _detail;
  Object? _error;
  bool _loading = true;
  bool _busy = false;
  final _cart = Cart();
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _orderId = widget.initialOrderId;
    _refresh();
    _poll = Timer.periodic(const Duration(seconds: 5), (_) {
      if (_orderId != null) _refresh(silent: true);
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _refresh({bool silent = false}) async {
    if (_orderId == null) {
      if (mounted) setState(() => _loading = false);
      return;
    }
    if (!silent) setState(() => _loading = true);
    final api = context.read<ApiClient>();
    try {
      final d = await api.orderDetail(_orderId!);
      if (!mounted) return;
      setState(() {
        _detail = d;
        _error = null;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (e.isAuthError) {
        await context.read<AuthState>().signOutLocal();
        return;
      }
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _openMenuPicker() async {
    final added = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => MenuPicker(cart: _cart, currency: '₹'),
    );
    if (added == true && mounted) setState(() {});
  }

  Future<void> _submitCart() async {
    if (_busy || _cart.isEmpty) return;
    setState(() => _busy = true);
    final api = context.read<ApiClient>();
    final auth = context.read<AuthState>();
    final messenger = ScaffoldMessenger.of(context);
    try {
      final orderId = await api.createOrAppend(
        tableId: widget.tableId,
        items: _cart.lines
            .map(
              (l) =>
                  (menuItemId: l.item.id, quantity: l.quantity, notes: l.notes),
            )
            .toList(growable: false),
      );
      if (!mounted) return;
      _cart.clear();
      _orderId = orderId;
      await _refresh();
      messenger.showSnackBar(const SnackBar(content: Text('Added to order')));
    } on ApiException catch (e) {
      if (e.isAuthError) {
        await auth.signOutLocal();
        return;
      }
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendKot() async {
    if (_busy || _orderId == null) return;
    setState(() => _busy = true);
    final api = context.read<ApiClient>();
    final auth = context.read<AuthState>();
    final messenger = ScaffoldMessenger.of(context);
    try {
      final res = await api.sendKot(_orderId!);
      await _refresh();
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            res.batchNumber == null
                ? 'Nothing new to send'
                : 'Sent KOT #${res.batchNumber} (${res.itemCount} items)',
          ),
        ),
      );
    } on ApiException catch (e) {
      if (e.isAuthError) {
        await auth.signOutLocal();
        return;
      }
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _removeServerItem(OrderItem item) async {
    final api = context.read<ApiClient>();
    final auth = context.read<AuthState>();
    final messenger = ScaffoldMessenger.of(context);
    try {
      await api.removeItem(item.id);
      await _refresh();
    } on ApiException catch (e) {
      if (e.isAuthError) {
        await auth.signOutLocal();
        return;
      }
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _setStatus(String status) async {
    if (_orderId == null) return;
    setState(() => _busy = true);
    final api = context.read<ApiClient>();
    final auth = context.read<AuthState>();
    final messenger = ScaffoldMessenger.of(context);
    try {
      await api.setStatus(_orderId!, status);
      await _refresh();
    } on ApiException catch (e) {
      if (e.isAuthError) {
        await auth.signOutLocal();
        return;
      }
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _ackCalls() async {
    final api = context.read<ApiClient>();
    try {
      await api.ackTableCalls(widget.tableId);
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Acknowledged')));
      }
    } catch (_) {
      /* ignore */
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text('Table ${widget.tableNumber}'),
        actions: [
          IconButton(
            tooltip: 'Acknowledge calls',
            icon: const Icon(Icons.notifications_off_outlined),
            onPressed: _ackCalls,
          ),
          PopupMenuButton<String>(
            tooltip: 'Status',
            enabled: _detail != null && !_detail!.isClosed,
            onSelected: _setStatus,
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'preparing', child: Text('Mark preparing')),
              PopupMenuItem(value: 'ready', child: Text('Mark ready')),
              PopupMenuItem(value: 'served', child: Text('Mark served')),
              PopupMenuDivider(),
              PopupMenuItem(value: 'cancelled', child: Text('Cancel order')),
            ],
          ),
        ],
      ),
      body: RefreshIndicator(onRefresh: () => _refresh(), child: _body(theme)),
      bottomNavigationBar: _BottomBar(
        cartLineCount: _cart.lines.length,
        cartSubtotal: _cart.subtotal,
        canSubmit: _cart.isNotEmpty && !_busy,
        canSendKot: (_detail?.hasUnsentItems ?? false) && !_busy,
        onAdd: _openMenuPicker,
        onSubmitCart: _submitCart,
        onSendKot: _sendKot,
      ),
    );
  }

  Widget _body(ThemeData theme) {
    if (_loading && _detail == null) {
      return const Center(child: CircularProgressIndicator());
    }
    final detail = _detail;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 120),
      children: [
        if (_error != null && detail == null)
          _errorBlock(theme)
        else if (detail == null)
          _emptyState(theme)
        else
          _orderHeader(theme, detail),
        if (_cart.isNotEmpty) _cartBlock(theme),
        if (detail != null && detail.items.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text(
            'Order lines',
            style: theme.textTheme.titleSmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          ...detail.items.map((item) => _serverItemTile(theme, item)),
          const SizedBox(height: 16),
          _totalsBlock(theme, detail),
        ],
      ],
    );
  }

  Widget _errorBlock(ThemeData theme) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: theme.colorScheme.errorContainer,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Row(
      children: [
        Icon(Icons.error_outline, color: theme.colorScheme.onErrorContainer),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            '$_error',
            style: TextStyle(color: theme.colorScheme.onErrorContainer),
          ),
        ),
        TextButton(onPressed: () => _refresh(), child: const Text('Retry')),
      ],
    ),
  );

  Widget _emptyState(ThemeData theme) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 40),
    child: Column(
      children: [
        Icon(
          Icons.restaurant_outlined,
          size: 56,
          color: theme.colorScheme.outline,
        ),
        const SizedBox(height: 12),
        Text(
          'No active order for this table',
          style: theme.textTheme.titleMedium,
        ),
        const SizedBox(height: 4),
        Text(
          'Tap “Add items” to start a new order.',
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    ),
  );

  Widget _orderHeader(ThemeData theme, OrderDetail detail) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                detail.orderNumber,
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 2),
              Row(
                children: [
                  _statusPill(theme, detail.status),
                  if (detail.source == 'self_order') ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.tertiaryContainer,
                        borderRadius: BorderRadius.circular(99),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.qr_code_2,
                            size: 12,
                            color: theme.colorScheme.onTertiaryContainer,
                          ),
                          const SizedBox(width: 3),
                          Text(
                            'Self-order',
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: theme.colorScheme.onTertiaryContainer,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
          const Spacer(),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                'Total',
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              Text(
                '₹${detail.total.toStringAsFixed(2)}',
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              Text(
                'KOTs sent: ${detail.kotCount}',
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _statusPill(ThemeData theme, String status) {
    final label = status[0].toUpperCase() + status.substring(1);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: theme.colorScheme.primaryContainer,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        style: theme.textTheme.labelSmall?.copyWith(
          color: theme.colorScheme.onPrimaryContainer,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _cartBlock(ThemeData theme) {
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Container(
        decoration: BoxDecoration(
          color: theme.colorScheme.secondaryContainer.withValues(alpha: 0.6),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: theme.colorScheme.secondary, width: 1),
        ),
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.shopping_bag_outlined,
                  color: theme.colorScheme.onSecondaryContainer,
                ),
                const SizedBox(width: 8),
                Text(
                  'Pending — not yet on the order',
                  style: theme.textTheme.labelLarge?.copyWith(
                    color: theme.colorScheme.onSecondaryContainer,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            for (final line in _cart.lines)
              _CartLineRow(
                line: line,
                onMinus: () => setState(
                  () => _cart.setQuantity(line.item.id, line.quantity - 1),
                ),
                onPlus: () => setState(
                  () => _cart.setQuantity(line.item.id, line.quantity + 1),
                ),
                onNotes: (v) => setState(() => _cart.setNotes(line.item.id, v)),
              ),
          ],
        ),
      ),
    );
  }

  Widget _serverItemTile(ThemeData theme, OrderItem item) {
    final unsent = !item.isSent;
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      padding: const EdgeInsets.fromLTRB(12, 10, 4, 10),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest,
              shape: BoxShape.circle,
            ),
            child: Text(
              '${item.quantity}',
              style: theme.textTheme.labelLarge?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        item.name,
                        style: theme.textTheme.bodyLarge?.copyWith(
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                    if (item.fromSelfOrder)
                      _miniPill(
                        theme,
                        Icons.qr_code_2,
                        'Self',
                        theme.colorScheme.tertiary,
                        theme.colorScheme.onTertiary,
                      ),
                    if (unsent)
                      Padding(
                        padding: const EdgeInsets.only(left: 4),
                        child: _miniPill(
                          theme,
                          Icons.pending_outlined,
                          'Unsent',
                          theme.colorScheme.secondary,
                          theme.colorScheme.onSecondary,
                        ),
                      ),
                    if (item.isSent)
                      Padding(
                        padding: const EdgeInsets.only(left: 4),
                        child: _miniPill(
                          theme,
                          Icons.send,
                          'KOT ${item.kotBatch}',
                          theme.colorScheme.primary,
                          theme.colorScheme.onPrimary,
                        ),
                      ),
                  ],
                ),
                if (item.notes != null)
                  Text(
                    '· ${item.notes!}',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                      fontStyle: FontStyle.italic,
                    ),
                  ),
                Text(
                  '₹${item.price.toStringAsFixed(2)} × ${item.quantity}'
                  '  =  ₹${(item.price * item.quantity).toStringAsFixed(2)}',
                  style: theme.textTheme.bodySmall,
                ),
              ],
            ),
          ),
          if (unsent)
            IconButton(
              tooltip: 'Remove',
              onPressed: () => _confirmRemove(item),
              icon: Icon(Icons.delete_outline, color: theme.colorScheme.error),
            ),
        ],
      ),
    );
  }

  Future<void> _confirmRemove(OrderItem item) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove item?'),
        content: Text('Remove "${item.name}" from this order?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (ok == true) _removeServerItem(item);
  }

  Widget _miniPill(
    ThemeData theme,
    IconData icon,
    String label,
    Color bg,
    Color fg,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(99),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 10, color: fg),
          const SizedBox(width: 2),
          Text(
            label,
            style: theme.textTheme.labelSmall?.copyWith(
              color: fg,
              fontSize: 9,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget _totalsBlock(ThemeData theme, OrderDetail detail) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          _totalRow(theme, 'Subtotal', detail.subtotal),
          if (detail.discountAmount > 0)
            _totalRow(theme, 'Discount', -detail.discountAmount),
          if (detail.cgstAmount > 0)
            _totalRow(theme, 'CGST', detail.cgstAmount),
          if (detail.sgstAmount > 0)
            _totalRow(theme, 'SGST', detail.sgstAmount),
          const Divider(),
          _totalRow(theme, 'Total', detail.total, bold: true),
        ],
      ),
    );
  }

  Widget _totalRow(
    ThemeData theme,
    String label,
    double amount, {
    bool bold = false,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: bold ? FontWeight.w700 : null,
              ),
            ),
          ),
          Text(
            '₹${amount.toStringAsFixed(2)}',
            style: theme.textTheme.bodyMedium?.copyWith(
              fontWeight: bold ? FontWeight.w700 : null,
            ),
          ),
        ],
      ),
    );
  }
}

class _CartLineRow extends StatelessWidget {
  final CartLine line;
  final VoidCallback onMinus;
  final VoidCallback onPlus;
  final ValueChanged<String?> onNotes;
  const _CartLineRow({
    required this.line,
    required this.onMinus,
    required this.onPlus,
    required this.onNotes,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  line.item.name,
                  style: theme.textTheme.bodyLarge?.copyWith(
                    fontWeight: FontWeight.w500,
                  ),
                ),
                Text(
                  '₹${line.item.price.toStringAsFixed(2)} × ${line.quantity}',
                  style: theme.textTheme.bodySmall,
                ),
                InkWell(
                  onTap: () async {
                    final value = await showDialog<String>(
                      context: context,
                      builder: (ctx) {
                        final controller = TextEditingController(
                          text: line.notes ?? '',
                        );
                        return AlertDialog(
                          title: Text(line.item.name),
                          content: TextField(
                            controller: controller,
                            maxLength: 200,
                            decoration: const InputDecoration(
                              labelText: 'Note for kitchen',
                              hintText: 'e.g. no onion',
                              border: OutlineInputBorder(),
                            ),
                          ),
                          actions: [
                            TextButton(
                              onPressed: () => Navigator.of(ctx).pop(null),
                              child: const Text('Cancel'),
                            ),
                            FilledButton(
                              onPressed: () =>
                                  Navigator.of(ctx).pop(controller.text.trim()),
                              child: const Text('Save'),
                            ),
                          ],
                        );
                      },
                    );
                    if (value != null) {
                      onNotes(value.isEmpty ? null : value);
                    }
                  },
                  child: Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Row(
                      children: [
                        Icon(
                          Icons.edit_note,
                          size: 14,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                        const SizedBox(width: 2),
                        Text(
                          line.notes?.isNotEmpty == true
                              ? line.notes!
                              : 'Add note',
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                            fontStyle: line.notes == null
                                ? FontStyle.italic
                                : FontStyle.normal,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          IconButton.outlined(
            onPressed: onMinus,
            icon: const Icon(Icons.remove),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6),
            child: Text('${line.quantity}', style: theme.textTheme.titleMedium),
          ),
          IconButton.filled(onPressed: onPlus, icon: const Icon(Icons.add)),
        ],
      ),
    );
  }
}

class _BottomBar extends StatelessWidget {
  final int cartLineCount;
  final double cartSubtotal;
  final bool canSubmit;
  final bool canSendKot;
  final VoidCallback onAdd;
  final VoidCallback onSubmitCart;
  final VoidCallback onSendKot;

  const _BottomBar({
    required this.cartLineCount,
    required this.cartSubtotal,
    required this.canSubmit,
    required this.canSendKot,
    required this.onAdd,
    required this.onSubmitCart,
    required this.onSendKot,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      child: Container(
        decoration: BoxDecoration(
          color: theme.colorScheme.surface,
          border: Border(
            top: BorderSide(color: theme.colorScheme.outlineVariant),
          ),
        ),
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
        child: Row(
          children: [
            OutlinedButton.icon(
              onPressed: onAdd,
              icon: const Icon(Icons.add),
              label: Text(
                cartLineCount == 0
                    ? 'Add items'
                    : '$cartLineCount  ·  ₹${cartSubtotal.toStringAsFixed(0)}',
              ),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 14,
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: cartLineCount > 0
                  ? FilledButton.icon(
                      onPressed: canSubmit ? onSubmitCart : null,
                      icon: const Icon(Icons.playlist_add_check),
                      label: const Text('Add to order'),
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                    )
                  : FilledButton.tonalIcon(
                      onPressed: canSendKot ? onSendKot : null,
                      icon: const Icon(Icons.send),
                      label: const Text('Send KOT'),
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
