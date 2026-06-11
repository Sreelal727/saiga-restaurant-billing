import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/api_client.dart';
import '../models/identity.dart';

const _kToken = 'mobile_token';
const _kIdentity = 'mobile_identity';

enum AuthStage { loading, signedOut, signedIn }

class AuthState extends ChangeNotifier {
  final ApiClient api;
  final FlutterSecureStorage _storage;

  AuthStage _stage = AuthStage.loading;
  Identity? _identity;
  String? _error;

  AuthState({required this.api, FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  AuthStage get stage => _stage;
  Identity? get identity => _identity;
  String? get error => _error;

  Future<void> bootstrap() async {
    try {
      final token = await _storage.read(key: _kToken);
      if (token == null || token.isEmpty) {
        _stage = AuthStage.signedOut;
        notifyListeners();
        return;
      }
      api.setToken(token);
      // Try cached identity first — avoids a network hop on cold start. Re-validate
      // on best-effort basis; if the server says the session is dead, sign out.
      final cached = await _storage.read(key: _kIdentity);
      if (cached != null) {
        try {
          _identity = Identity.fromJson(
            jsonDecode(cached) as Map<String, dynamic>,
          );
          _stage = AuthStage.signedIn;
          notifyListeners();
        } catch (_) {
          // bad cache — ignore, will refetch
        }
      }
      try {
        final fresh = await api.me();
        _identity = fresh;
        await _storage.write(
          key: _kIdentity,
          value: jsonEncode(fresh.toJson()),
        );
        _stage = AuthStage.signedIn;
        notifyListeners();
      } on ApiException catch (e) {
        if (e.isAuthError) {
          await _clear();
        } else {
          // Network blip — keep the cached session and let the UI retry later.
          if (_identity == null) {
            _stage = AuthStage.signedOut;
            notifyListeners();
          }
        }
      }
    } catch (e) {
      _error = e.toString();
      _stage = AuthStage.signedOut;
      notifyListeners();
    }
  }

  Future<bool> signIn({
    required String username,
    required String secret,
  }) async {
    _error = null;
    notifyListeners();
    try {
      final result = await api.login(username: username, secret: secret);
      _identity = result.identity;
      await _storage.write(key: _kToken, value: result.token);
      await _storage.write(
        key: _kIdentity,
        value: jsonEncode(result.identity.toJson()),
      );
      _stage = AuthStage.signedIn;
      notifyListeners();
      return true;
    } on ApiException catch (e) {
      _error = e.message;
      notifyListeners();
      return false;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<void> signOut() async {
    try {
      await api.logout();
    } catch (_) {
      // swallow — local clear is what matters
    }
    await _clear();
  }

  /// Called by UI screens that hit a 401: clear local state and bounce out.
  Future<void> signOutLocal() => _clear();

  Future<void> _clear() async {
    api.setToken(null);
    _identity = null;
    await _storage.delete(key: _kToken);
    await _storage.delete(key: _kIdentity);
    _stage = AuthStage.signedOut;
    notifyListeners();
  }
}
