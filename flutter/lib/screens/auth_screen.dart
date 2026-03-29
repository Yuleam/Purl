import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../config.dart';
import '../services/api_service.dart';

class AuthScreen extends StatefulWidget {
  final VoidCallback onAuth;
  const AuthScreen({super.key, required this.onAuth});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  bool _isLogin = true;
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();
  bool _loading = false;
  String? _error;

  // 인증 코드 화면 상태
  bool _showVerification = false;
  String _verifyEmail = '';
  final _codeController = TextEditingController();
  String? _codeError;
  bool _codeLoading = false;

  // 비밀번호 재설정 상태
  bool _showResetEmail = false;
  bool _showResetCode = false;
  String _resetEmail = '';
  final _resetEmailController = TextEditingController();
  final _resetCodeController = TextEditingController();
  final _newPasswordController = TextEditingController();
  final _newPasswordConfirmController = TextEditingController();
  String? _resetError;
  bool _resetLoading = false;

  bool get _passwordsMatch =>
      _confirmController.text == _passwordController.text;

  bool get _canSubmitRegister =>
      _emailController.text.trim().isNotEmpty &&
      _passwordController.text.length >= 8 &&
      _passwordsMatch;

  Future<void> _submit() async {
    final email = _emailController.text.trim();
    final password = _passwordController.text.trim();
    if (email.isEmpty || password.isEmpty) {
      setState(() => _error = '이메일과 비밀번호를 입력해주세요');
      return;
    }

    if (!_isLogin && !_passwordsMatch) {
      setState(() => _error = '비밀번호가 일치하지 않아요');
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    if (_isLogin) {
      final result = await ApiService().login(email, password);
      setState(() => _loading = false);

      if (result.containsKey('token')) {
        widget.onAuth();
      } else if (result['needsVerification'] == true) {
        // 로그인 시 미인증 계정 → 인증 화면으로
        setState(() {
          _showVerification = true;
          _verifyEmail = result['email'] as String? ?? email;
        });
      } else {
        setState(() => _error = result['error'] as String? ?? '로그인에 실패했어요');
      }
    } else {
      final result = await ApiService().register(email, password);
      setState(() => _loading = false);

      if (result['needsVerification'] == true) {
        setState(() {
          _showVerification = true;
          _verifyEmail = result['email'] as String? ?? email;
        });
      } else {
        setState(() => _error = result['error'] as String? ?? '가입에 실패했어요');
      }
    }
  }

  Future<void> _verifyCode() async {
    final code = _codeController.text.trim();
    if (code.length != 6) {
      setState(() => _codeError = '6자리 코드를 입력해주세요');
      return;
    }

    setState(() {
      _codeLoading = true;
      _codeError = null;
    });

    final token = await ApiService().verify(_verifyEmail, code);
    setState(() => _codeLoading = false);

    if (token != null) {
      widget.onAuth();
    } else {
      setState(() => _codeError = '올바르지 않은 코드예요. 다시 확인해주세요');
    }
  }

  Future<void> _resendCode() async {
    await ApiService().resendCode(_verifyEmail);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('새 인증 코드를 보냈어요'),
          duration: Duration(seconds: 2),
        ),
      );
    }
  }

  Future<void> _sendResetCode() async {
    final email = _resetEmailController.text.trim();
    if (email.isEmpty) {
      setState(() => _resetError = '이메일을 입력해주세요');
      return;
    }
    setState(() { _resetLoading = true; _resetError = null; });
    await ApiService().forgotPassword(email);
    setState(() {
      _resetLoading = false;
      _resetEmail = email;
      _showResetEmail = false;
      _showResetCode = true;
    });
  }

  Future<void> _submitReset() async {
    final code = _resetCodeController.text.trim();
    final pw = _newPasswordController.text;
    final pwConfirm = _newPasswordConfirmController.text;
    if (code.length != 6) {
      setState(() => _resetError = '6자리 코드를 입력해주세요');
      return;
    }
    if (pw.length < 8) {
      setState(() => _resetError = '비밀번호는 8자 이상이어야 해요');
      return;
    }
    if (pw != pwConfirm) {
      setState(() => _resetError = '비밀번호가 일치하지 않아요');
      return;
    }
    setState(() { _resetLoading = true; _resetError = null; });
    final result = await ApiService().resetPassword(_resetEmail, code, pw);
    setState(() => _resetLoading = false);
    if (result.containsKey('token')) {
      widget.onAuth();
    } else {
      setState(() => _resetError = result['error'] as String? ?? '문제가 발생했습니다');
    }
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _confirmController.dispose();
    _codeController.dispose();
    _resetEmailController.dispose();
    _resetCodeController.dispose();
    _newPasswordController.dispose();
    _newPasswordConfirmController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_showResetCode) return _buildResetCodeView();
    if (_showResetEmail) return _buildResetEmailView();
    if (_showVerification) return _buildVerificationView();
    return _buildAuthView();
  }

  Widget _buildVerificationView() {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '이메일 인증',
                  style: GoogleFonts.gowunBatang(
                    fontSize: 28,
                    fontWeight: FontWeight.w400,
                    color: AppColors.text,
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  '$_verifyEmail\n으로 인증 코드를 보냈어요',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 14,
                    color: AppColors.textSecondary,
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: 32),

                // 6자리 코드 입력
                TextField(
                  controller: _codeController,
                  keyboardType: TextInputType.number,
                  textAlign: TextAlign.center,
                  maxLength: 6,
                  style: const TextStyle(
                    fontSize: 24,
                    letterSpacing: 8,
                    fontWeight: FontWeight.w600,
                  ),
                  decoration: InputDecoration(
                    hintText: '000000',
                    hintStyle: TextStyle(
                      color: AppColors.textMuted.withValues(alpha: 0.4),
                      fontSize: 24,
                      letterSpacing: 8,
                    ),
                    counterText: '',
                    filled: false,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    border: UnderlineInputBorder(
                      borderSide: BorderSide(color: AppColors.border),
                    ),
                    enabledBorder: UnderlineInputBorder(
                      borderSide: BorderSide(color: AppColors.border),
                    ),
                    focusedBorder: const UnderlineInputBorder(
                      borderSide: BorderSide(color: AppColors.accent),
                    ),
                  ),
                  onSubmitted: (_) => _verifyCode(),
                ),
                const SizedBox(height: 8),

                if (_codeError != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _codeError!,
                    style: const TextStyle(fontSize: 13, color: AppColors.toneCritic),
                  ),
                ],
                const SizedBox(height: 24),

                // 인증 버튼
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _codeLoading ? null : _verifyCode,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.accent,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                      elevation: 0,
                    ),
                    child: _codeLoading
                        ? const SizedBox(
                            width: 20, height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('인증하기', style: TextStyle(fontSize: 15)),
                  ),
                ),
                const SizedBox(height: 16),

                // 재발송 + 뒤로가기
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    TextButton(
                      onPressed: _resendCode,
                      child: Text(
                        '코드 다시 보내기',
                        style: TextStyle(fontSize: 13, color: AppColors.textSecondary),
                      ),
                    ),
                    const SizedBox(width: 8),
                    TextButton(
                      onPressed: () => setState(() {
                        _showVerification = false;
                        _codeController.clear();
                        _codeError = null;
                      }),
                      child: Text(
                        '돌아가기',
                        style: TextStyle(fontSize: 13, color: AppColors.textMuted),
                      ),
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

  Widget _buildAuthView() {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // 로고
                Text(
                  'Mote',
                  style: GoogleFonts.gowunBatang(
                    fontSize: 32,
                    fontWeight: FontWeight.w400,
                    color: AppColors.textMuted,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  '다시 만나기 위한 도구',
                  style: TextStyle(
                    fontSize: 14,
                    color: AppColors.textMuted,
                  ),
                ),
                const SizedBox(height: 48),

                // 탭 전환
                Row(
                  children: [
                    _tabButton('로그인', _isLogin),
                    const SizedBox(width: 16),
                    _tabButton('가입', !_isLogin),
                  ],
                ),
                const SizedBox(height: 24),

                // 이메일
                TextField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  decoration: _inputDecoration('이메일'),
                ),
                const SizedBox(height: 12),

                // 비밀번호
                TextField(
                  controller: _passwordController,
                  obscureText: true,
                  decoration: _inputDecoration('비밀번호${_isLogin ? '' : ' (8자 이상)'}'),
                  onChanged: _isLogin ? null : (_) => setState(() {}),
                  onSubmitted: _isLogin ? (_) => _submit() : null,
                ),

                // 비밀번호 확인 (가입 시만)
                if (!_isLogin) ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: _confirmController,
                    obscureText: true,
                    decoration: _inputDecoration('비밀번호 확인'),
                    onChanged: (_) => setState(() {}),
                    onSubmitted: (_) => _submit(),
                  ),
                  if (_confirmController.text.isNotEmpty && !_passwordsMatch)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          '비밀번호가 일치하지 않아요',
                          style: TextStyle(fontSize: 12, color: AppColors.toneCritic),
                        ),
                      ),
                    ),
                ],
                // 비밀번호 찾기 (로그인 모드에서만)
                if (_isLogin)
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: () => setState(() {
                        _showResetEmail = true;
                        _resetEmailController.text = _emailController.text.trim();
                        _resetError = null;
                      }),
                      child: Text(
                        '비밀번호를 잊으셨나요?',
                        style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                      ),
                    ),
                  ),
                const SizedBox(height: 4),

                // 에러
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _error!,
                    style: const TextStyle(
                      fontSize: 13,
                      color: AppColors.toneCritic,
                    ),
                  ),
                ],
                const SizedBox(height: 24),

                // 버튼
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _loading
                        ? null
                        : (!_isLogin && !_canSubmitRegister)
                            ? null
                            : _submit,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.accent,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                      elevation: 0,
                    ),
                    child: _loading
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : Text(
                            _isLogin ? '로그인' : '가입',
                            style: const TextStyle(fontSize: 15),
                          ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _tabButton(String label, bool active) {
    return GestureDetector(
      onTap: () => setState(() {
        _isLogin = label == '로그인';
        _error = null;
        _confirmController.clear();
      }),
      child: Column(
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 15,
              fontWeight: active ? FontWeight.w600 : FontWeight.w400,
              color: active ? AppColors.text : AppColors.textMuted,
            ),
          ),
          const SizedBox(height: 4),
          Container(
            height: 2,
            width: 40,
            color: active ? AppColors.accent : Colors.transparent,
          ),
        ],
      ),
    );
  }

  InputDecoration _inputDecoration(String hint) {
    return InputDecoration(
      hintText: hint,
      hintStyle: const TextStyle(color: AppColors.textMuted, fontSize: 14),
      filled: false,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: UnderlineInputBorder(
        borderSide: BorderSide(color: AppColors.border),
      ),
      enabledBorder: UnderlineInputBorder(
        borderSide: BorderSide(color: AppColors.border),
      ),
      focusedBorder: const UnderlineInputBorder(
        borderSide: BorderSide(color: AppColors.accent),
      ),
    );
  }

  Widget _buildResetEmailView() {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '비밀번호 재설정',
                  style: GoogleFonts.gowunBatang(
                    fontSize: 28,
                    fontWeight: FontWeight.w400,
                    color: AppColors.text,
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  '가입한 이메일을 입력하면\n재설정 코드를 보내드려요',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 14, color: AppColors.textSecondary, height: 1.5),
                ),
                const SizedBox(height: 32),
                TextField(
                  controller: _resetEmailController,
                  keyboardType: TextInputType.emailAddress,
                  decoration: _inputDecoration('이메일'),
                  onSubmitted: (_) => _sendResetCode(),
                ),
                if (_resetError != null) ...[
                  const SizedBox(height: 12),
                  Text(_resetError!, style: const TextStyle(fontSize: 13, color: AppColors.toneCritic)),
                ],
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _resetLoading ? null : _sendResetCode,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.accent,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      elevation: 0,
                    ),
                    child: _resetLoading
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('코드 보내기', style: TextStyle(fontSize: 15)),
                  ),
                ),
                const SizedBox(height: 16),
                TextButton(
                  onPressed: () => setState(() { _showResetEmail = false; _resetError = null; }),
                  child: Text('돌아가기', style: TextStyle(fontSize: 13, color: AppColors.textMuted)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildResetCodeView() {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '비밀번호 재설정',
                  style: GoogleFonts.gowunBatang(
                    fontSize: 28,
                    fontWeight: FontWeight.w400,
                    color: AppColors.text,
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  '$_resetEmail\n으로 재설정 코드를 보냈어요',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 14, color: AppColors.textSecondary, height: 1.5),
                ),
                const SizedBox(height: 32),
                TextField(
                  controller: _resetCodeController,
                  keyboardType: TextInputType.number,
                  textAlign: TextAlign.center,
                  maxLength: 6,
                  style: const TextStyle(fontSize: 24, letterSpacing: 8, fontWeight: FontWeight.w600),
                  decoration: InputDecoration(
                    hintText: '000000',
                    hintStyle: TextStyle(color: AppColors.textMuted.withValues(alpha: 0.4), fontSize: 24, letterSpacing: 8),
                    counterText: '',
                    filled: false,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                    border: UnderlineInputBorder(borderSide: BorderSide(color: AppColors.border)),
                    enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: AppColors.border)),
                    focusedBorder: const UnderlineInputBorder(borderSide: BorderSide(color: AppColors.accent)),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _newPasswordController,
                  obscureText: true,
                  decoration: _inputDecoration('새 비밀번호 (8자 이상)'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _newPasswordConfirmController,
                  obscureText: true,
                  decoration: _inputDecoration('새 비밀번호 확인'),
                  onSubmitted: (_) => _submitReset(),
                ),
                if (_resetError != null) ...[
                  const SizedBox(height: 12),
                  Text(_resetError!, style: const TextStyle(fontSize: 13, color: AppColors.toneCritic)),
                ],
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _resetLoading ? null : _submitReset,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.accent,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      elevation: 0,
                    ),
                    child: _resetLoading
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('변경하기', style: TextStyle(fontSize: 15)),
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    TextButton(
                      onPressed: () async {
                        await ApiService().forgotPassword(_resetEmail);
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('새 재설정 코드를 보냈어요'), duration: Duration(seconds: 2)),
                          );
                        }
                      },
                      child: Text('코드 다시 보내기', style: TextStyle(fontSize: 13, color: AppColors.textSecondary)),
                    ),
                    const SizedBox(width: 8),
                    TextButton(
                      onPressed: () => setState(() {
                        _showResetCode = false;
                        _showResetEmail = false;
                        _resetError = null;
                        _resetCodeController.clear();
                        _newPasswordController.clear();
                        _newPasswordConfirmController.clear();
                      }),
                      child: Text('돌아가기', style: TextStyle(fontSize: 13, color: AppColors.textMuted)),
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
}
