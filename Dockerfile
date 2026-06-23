FROM python:3.12-slim

WORKDIR /app

# 安装 AKTools
RUN pip install --no-cache-dir aktools

# AKTools 默认监听 8080
EXPOSE 8080

CMD ["python", "-m", "aktools", "--host", "0.0.0.0", "--port", "8080"]
