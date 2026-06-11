import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/identity.dart';
import '../models/menu.dart';
import '../models/order_detail.dart';
import '../models/table_summary.dart';

/// Thrown when the backend responds with non-2xx. `status == 401` means the
/// token is gone — UI bounces to the login screen.
class ApiException implements Exception {
  final int status;
  final String message;
  const ApiException(this.status, this.message);

  @override
  String toString() => 'ApiException($status): $message';

  bool get isAuthError => status == 401;
}

/// Talks to /api/mobile/* on the Convex deployment. The base URL is supplied
/// at app boot from `--dart-define=API_BASE_URL=...` (see [resolveBaseUrl]).
/// Tokens are held in-memory and flushed by [setToken(null)] on logout.
class ApiClient {
  final String baseUrl;
  final http.Client _http;
  String? _token;

  ApiClient({required this.baseUrl, http.Client? client})
    : _http = client ?? http.Client();

  String? get token => _token;
  void setToken(String? value) {
    _token = value;
  }

  Map<String, String> _headers({bool withAuth = true}) {
    final h = <String, String>{'Content-Type': 'application/json'};
    if (withAuth && _token != null) h['Authorization'] = 'Bearer $_token';
    return h;
  }

  Uri _uri(String path, [Map<String, String>? query]) {
    final base = Uri.parse(baseUrl);
    return base.replace(
      path: '${base.path.replaceAll(RegExp(r'/$'), '')}$path',
      queryParameters: query,
    );
  }

  Future<dynamic> _get(String path, {Map<String, String>? query}) async {
    final res = await _http.get(_uri(path, query), headers: _headers());
    return _decode(res);
  }

  Future<dynamic> _post(
    String path,
    Map<String, dynamic> body, {
    bool withAuth = true,
  }) async {
    final res = await _http.post(
      _uri(path),
      headers: _headers(withAuth: withAuth),
      body: jsonEncode(body),
    );
    return _decode(res);
  }

  dynamic _decode(http.Response res) {
    final raw = res.body;
    Map<String, dynamic>? body;
    try {
      if (raw.isNotEmpty) {
        final parsed = jsonDecode(raw);
        if (parsed is Map<String, dynamic>) body = parsed;
      }
    } catch (_) {
      // fall through — surfaced as ApiException below
    }
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return body ?? const <String, dynamic>{};
    }
    final msg =
        (body?['error'] as String?) ?? 'Request failed (${res.statusCode})';
    throw ApiException(res.statusCode, msg);
  }

  // ─── Endpoints ─────────────────────────────────────────────────────────────

  Future<({String token, Identity identity})> login({
    required String username,
    required String secret,
  }) async {
    final res =
        await _post('/api/mobile/login', {
              'username': username,
              'secret': secret,
            }, withAuth: false)
            as Map<String, dynamic>;
    final token = res['token'] as String;
    final identity = Identity.fromJson(res['identity'] as Map<String, dynamic>);
    _token = token;
    return (token: token, identity: identity);
  }

  Future<Identity> me() async {
    final res = await _get('/api/mobile/me') as Map<String, dynamic>;
    return Identity.fromJson(res['identity'] as Map<String, dynamic>);
  }

  Future<void> logout() async {
    try {
      await _post('/api/mobile/logout', const {});
    } finally {
      _token = null;
    }
  }

  Future<HomePayload> home() async {
    final res = await _get('/api/mobile/home') as Map<String, dynamic>;
    return HomePayload.fromJson(res);
  }

  Future<List<MenuCategory>> menu() async {
    final res = await _get('/api/mobile/menu') as Map<String, dynamic>;
    final cats = res['categories'] as List<dynamic>? ?? const [];
    return cats
        .map((e) => MenuCategory.fromJson(e as Map<String, dynamic>))
        .toList(growable: false);
  }

  Future<OrderDetail> orderDetail(String orderId) async {
    final res =
        await _get('/api/mobile/orders/detail', query: {'order_id': orderId})
            as Map<String, dynamic>;
    return OrderDetail.fromJson(res);
  }

  Future<String> createOrAppend({
    required String tableId,
    required List<({String menuItemId, int quantity, String? notes})> items,
  }) async {
    final payload = {
      'table_id': tableId,
      'items': items
          .map(
            (i) => {
              'menu_item_id': i.menuItemId,
              'quantity': i.quantity,
              if (i.notes != null && i.notes!.isNotEmpty) 'notes': i.notes,
            },
          )
          .toList(growable: false),
    };
    final res =
        await _post('/api/mobile/orders', payload) as Map<String, dynamic>;
    return res['order_id'] as String;
  }

  Future<void> removeItem(String itemId) async {
    await _post('/api/mobile/orders/items/remove', {'item_id': itemId});
  }

  Future<({int? batchNumber, int itemCount})> sendKot(String orderId) async {
    final res =
        await _post('/api/mobile/orders/kot', {'order_id': orderId})
            as Map<String, dynamic>;
    return (
      batchNumber: (res['batch_number'] as num?)?.toInt(),
      itemCount: (res['item_count'] as num?)?.toInt() ?? 0,
    );
  }

  Future<void> setStatus(String orderId, String status) async {
    await _post('/api/mobile/orders/status', {
      'order_id': orderId,
      'status': status,
    });
  }

  Future<int> ackTableCalls(String tableId) async {
    final res = await _post('/api/mobile/calls/ack', {'table_id': tableId});
    if (res is num) return res.toInt();
    return 0;
  }

  void close() {
    _http.close();
  }
}
