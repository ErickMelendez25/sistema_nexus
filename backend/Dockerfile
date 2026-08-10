FROM python:3.11-slim
ARG COOLIFY_FQDN
ARG OPENAI_API_KEY
ARG GROQ_API_KEY
ARG ANTHROPIC_API_KEY
ARG DB_USER
ARG DB_PASSWORD
ARG DB_HOST
ARG DB_NAME
ARG DB_PORT
ARG PERUCOMPRAS_USER_1
ARG ONLYOFFICE_URL
ARG PERUCOMPRAS_LABEL_1
ARG PERUCOMPRAS_PASS_1
ARG PERUCOMPRAS_USER_2
ARG PERUCOMPRAS_PASS_2
ARG ERP_PASS
ARG PERUCOMPRAS_LABEL_2
ARG ERP_USER
ARG BACKEND_PUBLIC_URL
ARG UPLOAD_DIR
ARG AZURE_STORAGE_CONNECTION_STRING
ARG AZURE_CONTAINER_NAME
ARG AWS_BUCKET_NAME
ARG AWS_REGION
ARG STORAGE_BACKEND
ARG HELBOT_API_PUBLIC
ARG SERVICE_URL_BACKEND
ARG SERVICE_FQDN_BACKEND
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    default-libmysqlclient-dev \
    pkg-config \
    wget \
    unzip \
    gnupg \
    curl \
    fonts-liberation \
    libnss3 \
    libxss1 \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm1 \
    libreoffice \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*
RUN CHROME_VERSION=$(google-chrome --version | grep -oP '\d+\.\d+\.\d+\.\d+') && \
    wget -q "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chromedriver-linux64.zip" -O /tmp/chromedriver.zip && \
    unzip /tmp/chromedriver.zip -d /tmp/ && \
    mv /tmp/chromedriver-linux64/chromedriver /usr/local/bin/chromedriver && \
    chmod +x /usr/local/bin/chromedriver && \
    rm -rf /tmp/chromedriver*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 4002
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4002"]