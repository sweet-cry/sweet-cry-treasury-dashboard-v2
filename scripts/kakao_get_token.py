"""
카카오 리프레시 토큰 최초 발급 스크립트
딱 한 번만 실행하면 됩니다.

사용법:
  pip install requests
  python scripts/kakao_get_token.py

준비사항:
  1. https://developers.kakao.com 에서 앱 생성
  2. [앱 설정 > 카카오 로그인] 활성화
  3. [앱 설정 > 카카오 로그인 > 동의 항목] 에서
     '카카오톡 메시지 전송' 선택 동의 또는 필수 동의 설정
  4. [앱 설정 > 카카오 로그인 > Redirect URI] 에
     https://example.com 추가
  5. REST API 키 준비
"""

import requests, webbrowser

REST_API_KEY  = input("REST API 키를 입력하세요: ").strip()
REDIRECT_URI  = "https://example.com"

# 1단계: 브라우저에서 인증
auth_url = (
    f"https://kauth.kakao.com/oauth/authorize"
    f"?client_id={REST_API_KEY}"
    f"&redirect_uri={REDIRECT_URI}"
    f"&response_type=code"
    f"&scope=talk_message"
)
print(f"\n브라우저가 열립니다. 카카오 로그인 후 리다이렉트된 URL을 복사하세요.")
print(f"URL: {auth_url}\n")
webbrowser.open(auth_url)

# 2단계: 리다이렉트 URL에서 code 추출
redirected = input("리다이렉트된 전체 URL을 붙여넣으세요: ").strip()
# https://example.com?code=XXXXXX
code = redirected.split("code=")[-1].split("&")[0]
print(f"인증 코드: {code}")

# 3단계: 토큰 발급
r = requests.post("https://kauth.kakao.com/oauth/token", data={
    "grant_type":   "authorization_code",
    "client_id":    REST_API_KEY,
    "redirect_uri": REDIRECT_URI,
    "code":         code,
})
d = r.json()

if "refresh_token" not in d:
    print(f"오류: {d}")
else:
    print("\n" + "="*50)
    print("✅ 발급 완료! 아래 값을 GitHub Secrets에 등록하세요.")
    print("="*50)
    print(f"\nGitHub Secret 이름: KAKAO_REST_KEY")
    print(f"값: {REST_API_KEY}")
    print(f"\nGitHub Secret 이름: KAKAO_REFRESH_TOKEN")
    print(f"값: {d['refresh_token']}")
    print(f"\n(참고) 현재 액세스 토큰: {d['access_token'][:20]}...")
    print(f"(참고) 리프레시 토큰 만료: 60일 (자동 갱신됨)")
    print("="*50)
