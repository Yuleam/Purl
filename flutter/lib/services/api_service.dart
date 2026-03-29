import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config.dart';
import '../models/fiber.dart';
import 'auth_service.dart';

class ApiService {
  static final ApiService _instance = ApiService._();
  factory ApiService() => _instance;
  ApiService._();

  Future<Map<String, String>> _headers() async {
    final token = await AuthService().getToken();
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  Uri _uri(String path, [Map<String, String>? query]) {
    return Uri.parse('${AppConfig.apiBaseUrl}$path')
        .replace(queryParameters: query);
  }

  // === 인증 ===

  /// 가입 — 성공 시 {needsVerification, email} 반환, 실패 시 {error} 반환
  Future<Map<String, dynamic>> register(String email, String password) async {
    final res = await http.post(
      _uri('/api/auth/register'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  /// 인증 코드 확인 — 성공 시 token 반환
  Future<String?> verify(String email, String code) async {
    final res = await http.post(
      _uri('/api/auth/verify'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'code': code}),
    );
    if (res.statusCode == 200) {
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final token = data['token'] as String;
      await AuthService().saveToken(token);
      return token;
    }
    return null;
  }

  /// 인증 코드 재발송
  Future<void> resendCode(String email) async {
    await http.post(
      _uri('/api/auth/resend'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email}),
    );
  }

  Future<Map<String, dynamic>> login(String email, String password) async {
    final res = await http.post(
      _uri('/api/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode == 200 && data.containsKey('token')) {
      await AuthService().saveToken(data['token'] as String);
    }
    return data;
  }

  /// 비밀번호 재설정 코드 요청
  Future<void> forgotPassword(String email) async {
    await http.post(
      _uri('/api/auth/forgot-password'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email}),
    );
  }

  /// 비밀번호 재설정 — 성공 시 token 반환
  Future<Map<String, dynamic>> resetPassword(String email, String code, String password) async {
    final res = await http.post(
      _uri('/api/auth/reset-password'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'code': code, 'password': password}),
    );
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode == 200 && data.containsKey('token')) {
      await AuthService().saveToken(data['token'] as String);
    }
    return data;
  }

  // === 프로필 ===

  Future<Map<String, dynamic>?> getProfile() async {
    final res = await http.get(_uri('/api/auth/profile'), headers: await _headers());
    if (res.statusCode == 200) {
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      return data['profile'] as Map<String, dynamic>?;
    }
    return null;
  }

  Future<bool> saveProfile({String? occupation, String? context}) async {
    final res = await http.post(
      _uri('/api/auth/profile'),
      headers: await _headers(),
      body: jsonEncode({'occupation': occupation ?? '', 'context': context ?? ''}),
    );
    return res.statusCode == 200;
  }

  // === 조각 ===

  Future<Fiber?> createFiber({
    required String text,
    required int tension,
    required String tone,
    String? thought,
    String? source,
  }) async {
    final res = await http.post(
      _uri('/api/fibers'),
      headers: await _headers(),
      body: jsonEncode({
        'text': text,
        'tension': tension,
        'tone': tone,
        if (thought != null && thought.isNotEmpty) 'thought': thought,
        if (source != null && source.isNotEmpty) 'source': source,
      }),
    );
    if (res.statusCode == 200 || res.statusCode == 201) {
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      return Fiber.fromJson(data);
    }
    return null;
  }

  Future<Fiber?> getFiber(int id) async {
    final res = await http.get(_uri('/api/fibers/$id'), headers: await _headers());
    if (res.statusCode == 200) {
      return Fiber.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
    }
    return null;
  }

  Future<List<Fiber>> searchFibers(String query) async {
    final res = await http.get(
      _uri('/api/fibers', {'search': query}),
      headers: await _headers(),
    );
    if (res.statusCode == 200) {
      final list = jsonDecode(res.body) as List<dynamic>;
      return list.map((j) => Fiber.fromJson(j as Map<String, dynamic>)).toList();
    }
    return [];
  }

  Future<bool> deleteFiber(int id) async {
    final res = await http.delete(_uri('/api/fibers/$id'), headers: await _headers());
    return res.statusCode == 200 || res.statusCode == 204;
  }

  Future<Fiber?> updateFiber(int id, Map<String, dynamic> updates) async {
    final res = await http.patch(
      _uri('/api/fibers/$id'),
      headers: await _headers(),
      body: jsonEncode(updates),
    );
    if (res.statusCode == 200) {
      return Fiber.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
    }
    return null;
  }

  // === 만남 ===

  Future<Fiber?> getEncounter() async {
    final res = await http.get(_uri('/api/encounter'), headers: await _headers());
    if (res.statusCode == 200) {
      final data = jsonDecode(res.body);
      if (data == null) return null;
      return Fiber.fromJson(data as Map<String, dynamic>);
    }
    return null;
  }

  Future<void> recordEncounter(int fiberId) async {
    await http.post(
      _uri('/api/encounter'),
      headers: await _headers(),
      body: jsonEncode({'fiber_id': fiberId}),
    );
  }

  // === 궤적 ===

  Future<List<Fiber>> getTrail({String? from, String? to}) async {
    final query = <String, String>{};
    if (from != null) query['from'] = from;
    if (to != null) query['to'] = to;
    final res = await http.get(
      _uri('/api/trail', query.isEmpty ? null : query),
      headers: await _headers(),
    );
    if (res.statusCode == 200) {
      final list = jsonDecode(res.body) as List<dynamic>;
      return list.map((j) => Fiber.fromJson(j as Map<String, dynamic>)).toList();
    }
    return [];
  }

  // === 연결 ===

  Future<bool> createLink(List<int> memberIds, String why) async {
    final res = await http.post(
      _uri('/api/links'),
      headers: await _headers(),
      body: jsonEncode({'members': memberIds, 'why': why}),
    );
    return res.statusCode == 200 || res.statusCode == 201;
  }

  Future<List<FiberLink>> getFiberLinks(int fiberId) async {
    final res = await http.get(
      _uri('/api/fibers/$fiberId/links'),
      headers: await _headers(),
    );
    if (res.statusCode == 200) {
      final list = jsonDecode(res.body) as List<dynamic>;
      return list.map((j) => FiberLink.fromJson(j as Map<String, dynamic>)).toList();
    }
    return [];
  }

  Future<bool> deleteLink(int id) async {
    final res = await http.delete(_uri('/api/links/$id'), headers: await _headers());
    return res.statusCode == 200 || res.statusCode == 204;
  }

  // === 주변부 ===

  Future<List<Fiber>> getPeriphery({String? text, String? tone, String? source}) async {
    final query = <String, String>{};
    if (text != null && text.isNotEmpty) query['text'] = text;
    if (tone != null) query['tone'] = tone;
    if (source != null && source.isNotEmpty) query['source'] = source;
    final res = await http.get(
      _uri('/api/periphery', query.isEmpty ? null : query),
      headers: await _headers(),
    );
    if (res.statusCode == 200) {
      final list = jsonDecode(res.body) as List<dynamic>;
      return list.map((j) => Fiber.fromJson(j as Map<String, dynamic>)).toList();
    }
    return [];
  }

  // === 답글 ===

  Future<FiberReply?> addReply(int fiberId, String text) async {
    final res = await http.post(
      _uri('/api/fibers/$fiberId/replies'),
      headers: await _headers(),
      body: jsonEncode({'text': text}),
    );
    if (res.statusCode == 200 || res.statusCode == 201) {
      return FiberReply.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
    }
    return null;
  }

  // === 헬스 ===

  Future<bool> checkHealth() async {
    try {
      final res = await http.get(_uri('/api/health'));
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }
}
